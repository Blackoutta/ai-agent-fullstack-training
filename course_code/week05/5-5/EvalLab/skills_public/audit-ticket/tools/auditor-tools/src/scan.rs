//! Static-analysis scanner for Solana/Anchor Rust codebases.
//!
//! Parses each `*.rs` file with `syn::parse_file` (which yields real line numbers
//! when `proc-macro2`'s `span-locations` feature is enabled) and walks the AST
//! with a [`syn::visit::Visit`] implementation to enumerate the risky surface an
//! auditor would otherwise have to find by hand.

use std::path::Path;

use quote::ToTokens;
use serde::Serialize;
use syn::spanned::Spanned;
use syn::visit::Visit;
use walkdir::WalkDir;

const SNIPPET_MAX: usize = 80;

/// Top-level scan report — serialized to a single JSON object.
#[derive(Debug, Serialize)]
pub struct ScanReport {
    pub root: String,
    pub files_scanned: usize,
    pub instructions: Vec<Instruction>,
    pub accounts_structs: Vec<AccountsStruct>,
    pub pdas: Vec<Pda>,
    pub arithmetic_sites: Vec<ArithmeticSite>,
    pub panic_sites: Vec<PanicSite>,
    pub unsafe_blocks: Vec<UnsafeBlock>,
    pub cpi_sites: Vec<CpiSite>,
    pub remaining_accounts_sites: Vec<RemainingAccountsSite>,
    pub functions: Vec<FunctionDef>,
}

#[derive(Debug, Serialize)]
pub struct Arg {
    pub name: String,
    pub ty: String,
}

#[derive(Debug, Serialize)]
pub struct Instruction {
    pub name: String,
    pub file: String,
    pub line: usize,
    pub args: Vec<Arg>,
}

#[derive(Debug, Serialize)]
pub struct AccountsStruct {
    pub name: String,
    pub file: String,
    pub line: usize,
    pub fields: Vec<AccountField>,
}

#[derive(Debug, Serialize)]
pub struct AccountField {
    pub name: String,
    pub ty: String,
    /// True when the field type is Anchor's `UncheckedAccount` (manual validation required).
    pub unchecked: bool,
    pub constraints: AccountConstraints,
}

#[derive(Debug, Serialize)]
pub struct AccountConstraints {
    pub init: bool,
    pub init_if_needed: bool,
    #[serde(rename = "mut")]
    pub is_mut: bool,
    pub signer: bool,
    pub has_one: Vec<String>,
    pub seeds: Vec<String>,
    pub bump: bool,
    pub close: Option<String>,
    pub owner: Option<String>,
    pub token: bool,
    pub associated_token: bool,
    pub realloc: bool,
    pub raw: String,
}

#[derive(Debug, Serialize)]
pub struct Pda {
    #[serde(rename = "struct")]
    pub struct_name: String,
    pub field: String,
    pub seeds: Vec<String>,
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Serialize)]
pub struct ArithmeticSite {
    pub file: String,
    pub line: usize,
    pub op: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct PanicSite {
    pub file: String,
    pub line: usize,
    pub kind: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct UnsafeBlock {
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Serialize)]
pub struct CpiSite {
    pub file: String,
    pub line: usize,
    pub kind: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct RemainingAccountsSite {
    pub file: String,
    pub line: usize,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct FunctionDef {
    pub name: String,
    pub file: String,
    pub line: usize,
    #[serde(rename = "pub")]
    pub is_pub: bool,
}

/// Scan every `*.rs` file under `root`, returning one merged report.
///
/// Files that fail to parse are skipped (best-effort). Directories named
/// `target`, `.git`, and `node_modules` are pruned.
pub fn scan_path(root: &Path) -> ScanReport {
    let mut report = ScanReport {
        root: root.display().to_string(),
        files_scanned: 0,
        instructions: Vec::new(),
        accounts_structs: Vec::new(),
        pdas: Vec::new(),
        arithmetic_sites: Vec::new(),
        panic_sites: Vec::new(),
        unsafe_blocks: Vec::new(),
        cpi_sites: Vec::new(),
        remaining_accounts_sites: Vec::new(),
        functions: Vec::new(),
    };

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_pruned_dir(e.path()))
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("rs") {
            continue;
        }
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let ast = match syn::parse_file(&source) {
            Ok(a) => a,
            Err(_) => continue,
        };
        report.files_scanned += 1;
        let file_label = path.display().to_string();
        let mut visitor = FileVisitor::new(&file_label);
        visitor.visit_file(&ast);
        visitor.drain_into(&mut report);
    }

    report
}

/// Scan a single in-memory source string (used by tests and the demo path).
///
/// Returns `None` if the source does not parse.
pub fn scan_source(file_label: &str, source: &str) -> Option<ScanReport> {
    let ast = syn::parse_file(source).ok()?;
    let mut report = ScanReport {
        root: file_label.to_string(),
        files_scanned: 1,
        instructions: Vec::new(),
        accounts_structs: Vec::new(),
        pdas: Vec::new(),
        arithmetic_sites: Vec::new(),
        panic_sites: Vec::new(),
        unsafe_blocks: Vec::new(),
        cpi_sites: Vec::new(),
        remaining_accounts_sites: Vec::new(),
        functions: Vec::new(),
    };
    let mut visitor = FileVisitor::new(file_label);
    visitor.visit_file(&ast);
    visitor.drain_into(&mut report);
    Some(report)
}

fn is_pruned_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|s| s.to_str()),
        Some("target") | Some(".git") | Some("node_modules")
    )
}

fn truncate_snippet(s: &str) -> String {
    // Collapse internal whitespace so multi-line exprs read on one line.
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > SNIPPET_MAX {
        let mut out: String = collapsed.chars().take(SNIPPET_MAX).collect();
        out.push_str("...");
        out
    } else {
        collapsed
    }
}

fn tokens_string<T: ToTokens>(node: &T) -> String {
    node.to_token_stream().to_string()
}

/// Per-file AST visitor. Accumulates findings, then `drain_into` merges them.
struct FileVisitor {
    file: String,
    /// Depth of `#[program]` module nesting we are currently inside.
    program_depth: usize,
    instructions: Vec<Instruction>,
    accounts_structs: Vec<AccountsStruct>,
    pdas: Vec<Pda>,
    arithmetic_sites: Vec<ArithmeticSite>,
    panic_sites: Vec<PanicSite>,
    unsafe_blocks: Vec<UnsafeBlock>,
    cpi_sites: Vec<CpiSite>,
    remaining_accounts_sites: Vec<RemainingAccountsSite>,
    functions: Vec<FunctionDef>,
}

impl FileVisitor {
    fn new(file: &str) -> Self {
        Self {
            file: file.to_string(),
            program_depth: 0,
            instructions: Vec::new(),
            accounts_structs: Vec::new(),
            pdas: Vec::new(),
            arithmetic_sites: Vec::new(),
            panic_sites: Vec::new(),
            unsafe_blocks: Vec::new(),
            cpi_sites: Vec::new(),
            remaining_accounts_sites: Vec::new(),
            functions: Vec::new(),
        }
    }

    fn drain_into(self, report: &mut ScanReport) {
        report.instructions.extend(self.instructions);
        report.accounts_structs.extend(self.accounts_structs);
        report.pdas.extend(self.pdas);
        report.arithmetic_sites.extend(self.arithmetic_sites);
        report.panic_sites.extend(self.panic_sites);
        report.unsafe_blocks.extend(self.unsafe_blocks);
        report.cpi_sites.extend(self.cpi_sites);
        report
            .remaining_accounts_sites
            .extend(self.remaining_accounts_sites);
        report.functions.extend(self.functions);
    }

    fn record_instruction(&mut self, func: &syn::ItemFn) {
        let name = func.sig.ident.to_string();
        let line = func.sig.ident.span().start().line;
        let args = collect_instruction_args(&func.sig);
        self.instructions.push(Instruction {
            name,
            file: self.file.clone(),
            line,
            args,
        });
    }

    fn record_accounts_struct(&mut self, item: &syn::ItemStruct) {
        let struct_name = item.ident.to_string();
        let line = item.ident.span().start().line;
        let mut fields = Vec::new();

        if let syn::Fields::Named(named) = &item.fields {
            for field in &named.named {
                let field_name = match &field.ident {
                    Some(id) => id.to_string(),
                    None => continue,
                };
                let ty = tokens_string(&field.ty);
                let (constraints, seeds) = parse_account_attr(&field.attrs);

                if !seeds.is_empty() {
                    self.pdas.push(Pda {
                        struct_name: struct_name.clone(),
                        field: field_name.clone(),
                        seeds: seeds.clone(),
                        file: self.file.clone(),
                        line: field.ident.span().start().line,
                    });
                }

                fields.push(AccountField {
                    name: field_name,
                    ty: ty.clone(),
                    unchecked: is_unchecked_account_ty(&ty),
                    constraints,
                });
            }
        }

        self.accounts_structs.push(AccountsStruct {
            name: struct_name,
            file: self.file.clone(),
            line,
            fields,
        });
    }
}

impl<'ast> Visit<'ast> for FileVisitor {
    fn visit_item_mod(&mut self, node: &'ast syn::ItemMod) {
        let is_program = has_attr_path(&node.attrs, "program");
        if is_program {
            self.program_depth += 1;
            // Instructions are the fns directly in the program module.
            if let Some((_brace, items)) = &node.content {
                for item in items {
                    if let syn::Item::Fn(func) = item {
                        self.record_instruction(func);
                    }
                }
            }
        }
        syn::visit::visit_item_mod(self, node);
        if is_program {
            self.program_depth -= 1;
        }
    }

    fn visit_item_struct(&mut self, node: &'ast syn::ItemStruct) {
        if derive_contains(&node.attrs, "Accounts") {
            self.record_accounts_struct(node);
        }
        syn::visit::visit_item_struct(self, node);
    }

    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {
        self.functions.push(FunctionDef {
            name: node.sig.ident.to_string(),
            file: self.file.clone(),
            line: node.sig.ident.span().start().line,
            is_pub: matches!(node.vis, syn::Visibility::Public(_)),
        });
        syn::visit::visit_item_fn(self, node);
    }

    fn visit_impl_item_fn(&mut self, node: &'ast syn::ImplItemFn) {
        self.functions.push(FunctionDef {
            name: node.sig.ident.to_string(),
            file: self.file.clone(),
            line: node.sig.ident.span().start().line,
            is_pub: matches!(node.vis, syn::Visibility::Public(_)),
        });
        syn::visit::visit_impl_item_fn(self, node);
    }

    fn visit_expr_binary(&mut self, node: &'ast syn::ExprBinary) {
        // syn 2 models both plain arithmetic (`a + b`) and compound assignment
        // (`a += b`) as `ExprBinary`, distinguished by the `BinOp` variant.
        let op = match node.op {
            syn::BinOp::Add(_) => Some("+"),
            syn::BinOp::Sub(_) => Some("-"),
            syn::BinOp::Mul(_) => Some("*"),
            syn::BinOp::Div(_) => Some("/"),
            syn::BinOp::AddAssign(_) => Some("+="),
            syn::BinOp::SubAssign(_) => Some("-="),
            syn::BinOp::MulAssign(_) => Some("*="),
            syn::BinOp::DivAssign(_) => Some("/="),
            _ => None,
        };
        if let Some(op) = op {
            self.arithmetic_sites.push(ArithmeticSite {
                file: self.file.clone(),
                line: node.span().start().line,
                op: op.to_string(),
                snippet: truncate_snippet(&tokens_string(node)),
            });
        }
        syn::visit::visit_expr_binary(self, node);
    }

    fn visit_expr_method_call(&mut self, node: &'ast syn::ExprMethodCall) {
        let method = node.method.to_string();
        if method == "unwrap" {
            self.panic_sites.push(PanicSite {
                file: self.file.clone(),
                line: node.method.span().start().line,
                kind: "unwrap".to_string(),
                snippet: truncate_snippet(&tokens_string(node)),
            });
        } else if method == "expect" {
            self.panic_sites.push(PanicSite {
                file: self.file.clone(),
                line: node.method.span().start().line,
                kind: "expect".to_string(),
                snippet: truncate_snippet(&tokens_string(node)),
            });
        }
        syn::visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_index(&mut self, node: &'ast syn::ExprIndex) {
        self.panic_sites.push(PanicSite {
            file: self.file.clone(),
            line: node.span().start().line,
            kind: "index".to_string(),
            snippet: truncate_snippet(&tokens_string(node)),
        });
        syn::visit::visit_expr_index(self, node);
    }

    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        if let Some(seg) = node.path.segments.last() {
            let name = seg.ident.to_string();
            if matches!(name.as_str(), "panic" | "unreachable" | "unwrap") {
                self.panic_sites.push(PanicSite {
                    file: self.file.clone(),
                    line: node.path.span().start().line,
                    kind: "panic".to_string(),
                    snippet: truncate_snippet(&tokens_string(node)),
                });
            }
        }
        syn::visit::visit_macro(self, node);
    }

    fn visit_expr_unsafe(&mut self, node: &'ast syn::ExprUnsafe) {
        self.unsafe_blocks.push(UnsafeBlock {
            file: self.file.clone(),
            line: node.unsafe_token.span().start().line,
        });
        syn::visit::visit_expr_unsafe(self, node);
    }

    fn visit_expr_field(&mut self, node: &'ast syn::ExprField) {
        if let syn::Member::Named(ident) = &node.member {
            if ident == "remaining_accounts" {
                self.remaining_accounts_sites.push(RemainingAccountsSite {
                    file: self.file.clone(),
                    line: ident.span().start().line,
                    snippet: truncate_snippet(&tokens_string(node)),
                });
            }
        }
        syn::visit::visit_expr_field(self, node);
    }

    fn visit_expr_call(&mut self, node: &'ast syn::ExprCall) {
        if let syn::Expr::Path(path_expr) = node.func.as_ref() {
            if let Some(seg) = path_expr.path.segments.last() {
                let name = seg.ident.to_string();
                let kind = match name.as_str() {
                    "invoke" => Some("invoke"),
                    "invoke_signed" => Some("invoke_signed"),
                    _ => None,
                };
                if let Some(kind) = kind {
                    self.cpi_sites.push(CpiSite {
                        file: self.file.clone(),
                        line: seg.ident.span().start().line,
                        kind: kind.to_string(),
                        snippet: truncate_snippet(&tokens_string(node)),
                    });
                }
            }
        }
        syn::visit::visit_expr_call(self, node);
    }

    fn visit_path(&mut self, node: &'ast syn::Path) {
        // Detect `.invoke()` / `.invoke_signed()` method-style CPIs and any
        // reference to `CpiContext`.
        if let Some(seg) = node.segments.last() {
            let name = seg.ident.to_string();
            if name == "CpiContext" {
                self.cpi_sites.push(CpiSite {
                    file: self.file.clone(),
                    line: seg.ident.span().start().line,
                    kind: "CpiContext".to_string(),
                    snippet: "CpiContext".to_string(),
                });
            }
        }
        syn::visit::visit_path(self, node);
    }
}

/// Collect the instruction-data arguments of an Anchor handler.
///
/// Skips `self` receivers and the leading Anchor `Context<..>` parameter so the
/// reported args are exactly the caller-supplied instruction data (`amount`,
/// `params`, ...), which is what an auditor reasons about.
fn collect_instruction_args(sig: &syn::Signature) -> Vec<Arg> {
    let mut args = Vec::new();
    for input in &sig.inputs {
        if let syn::FnArg::Typed(pat_type) = input {
            let ty = tokens_string(&pat_type.ty);
            if is_context_ty(&pat_type.ty) {
                continue;
            }
            let name = match pat_type.pat.as_ref() {
                syn::Pat::Ident(id) => id.ident.to_string(),
                other => tokens_string(other),
            };
            args.push(Arg { name, ty });
        }
    }
    args
}

/// True when an Accounts field type is Anchor's `UncheckedAccount` (any path qualification).
fn is_unchecked_account_ty(ty_str: &str) -> bool {
    ty_str.contains("UncheckedAccount")
}

/// True if the type is Anchor's `Context<..>` (possibly path-qualified).
fn is_context_ty(ty: &syn::Type) -> bool {
    if let syn::Type::Path(type_path) = ty {
        if let Some(seg) = type_path.path.segments.last() {
            return seg.ident == "Context";
        }
    }
    false
}

/// True if any attribute's path matches `ident` (single-segment).
fn has_attr_path(attrs: &[syn::Attribute], ident: &str) -> bool {
    attrs.iter().any(|a| a.path().is_ident(ident))
}

/// True if any `#[derive(...)]` attribute lists a trait named `trait_name`.
fn derive_contains(attrs: &[syn::Attribute], trait_name: &str) -> bool {
    for attr in attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let mut found = false;
        // parse_nested_meta walks each path inside the derive list.
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident(trait_name) {
                found = true;
            }
            Ok(())
        });
        if found {
            return true;
        }
    }
    false
}

/// Parse the `#[account(...)]` attribute of an Accounts field, returning the
/// structured constraints plus the extracted `seeds` list (also surfaced
/// separately for the top-level `pdas` array).
fn parse_account_attr(attrs: &[syn::Attribute]) -> (AccountConstraints, Vec<String>) {
    let mut constraints = AccountConstraints {
        init: false,
        init_if_needed: false,
        is_mut: false,
        signer: false,
        has_one: Vec::new(),
        seeds: Vec::new(),
        bump: false,
        close: None,
        owner: None,
        token: false,
        associated_token: false,
        realloc: false,
        raw: String::new(),
    };

    let account_attr = attrs.iter().find(|a| a.path().is_ident("account"));
    let attr = match account_attr {
        Some(a) => a,
        None => return (constraints, Vec::new()),
    };

    constraints.raw = tokens_string(attr);

    // The inner tokens of `account(...)` are a comma-separated meta list. We
    // tokenize once and scan structurally: `parse_nested_meta` handles the
    // scalar flags and `key = value` pairs; `seeds = [ ... ]` needs the raw
    // token walk because its value is a bracketed array.
    let inner_tokens = match attr.meta.require_list() {
        Ok(list) => list.tokens.clone(),
        Err(_) => proc_macro2::TokenStream::new(),
    };
    let metas = split_top_level_metas(inner_tokens);
    for meta in &metas {
        apply_meta(meta, &mut constraints);
    }

    let seeds = constraints.seeds.clone();
    (constraints, seeds)
}

/// A single top-level constraint fragment, e.g. `init`, `mut`, `has_one = x`,
/// or `seeds = [ a, b ]`, preserved as its own token stream.
struct MetaFragment {
    key: String,
    /// Tokens after the `=`, if any.
    value: Option<proc_macro2::TokenStream>,
}

/// Split the inner tokens of `account(...)` on top-level commas, capturing the
/// leading identifier and any `= <value>` tail for each fragment. Commas inside
/// `[]`, `()`, or `{}` are ignored so `seeds = [a, b]` stays intact.
fn split_top_level_metas(tokens: proc_macro2::TokenStream) -> Vec<MetaFragment> {
    use proc_macro2::TokenTree;

    let mut fragments = Vec::new();
    let mut key = String::new();
    let mut value: Option<proc_macro2::TokenStream> = None;
    let mut seen_eq = false;
    let mut value_acc = proc_macro2::TokenStream::new();

    let flush = |key: &mut String,
                 value: &mut Option<proc_macro2::TokenStream>,
                 seen_eq: &mut bool,
                 value_acc: &mut proc_macro2::TokenStream,
                 fragments: &mut Vec<MetaFragment>| {
        if key.is_empty() && value_acc.is_empty() && !*seen_eq {
            return;
        }
        let val = if *seen_eq {
            Some(std::mem::take(value_acc))
        } else {
            value.take()
        };
        fragments.push(MetaFragment {
            key: std::mem::take(key),
            value: val,
        });
        *seen_eq = false;
        *value_acc = proc_macro2::TokenStream::new();
    };

    for tt in tokens {
        match &tt {
            TokenTree::Punct(p) if p.as_char() == ',' => {
                flush(
                    &mut key,
                    &mut value,
                    &mut seen_eq,
                    &mut value_acc,
                    &mut fragments,
                );
            }
            TokenTree::Punct(p) if p.as_char() == '=' && !seen_eq => {
                seen_eq = true;
            }
            other => {
                if seen_eq {
                    value_acc.extend(std::iter::once(other.clone()));
                } else if key.is_empty() {
                    // First token of the fragment: expect the constraint name.
                    if let TokenTree::Ident(id) = other {
                        key = id.to_string();
                    } else {
                        // Path-like keys such as `token::mint`. Accumulate.
                        key = other.to_string();
                    }
                } else {
                    // Path continuation, e.g. the `::mint` in `token::mint`.
                    key.push_str(&other.to_string());
                }
            }
        }
    }
    flush(
        &mut key,
        &mut value,
        &mut seen_eq,
        &mut value_acc,
        &mut fragments,
    );

    fragments
}

fn apply_meta(meta: &MetaFragment, c: &mut AccountConstraints) {
    let key = meta.key.as_str();
    match key {
        "init" => c.init = true,
        "init_if_needed" => c.init_if_needed = true,
        "mut" => c.is_mut = true,
        "signer" => c.signer = true,
        "bump" => c.bump = true,
        "realloc" => c.realloc = true,
        "has_one" => {
            if let Some(v) = &meta.value {
                // has_one = x  (may carry `@ Error`; keep just the identifier).
                let s = v.to_string();
                let ident = s.split_whitespace().next().unwrap_or("").to_string();
                if !ident.is_empty() {
                    c.has_one.push(ident);
                }
            }
        }
        "close" => {
            if let Some(v) = &meta.value {
                c.close = Some(
                    v.to_string()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
        }
        "owner" => {
            if let Some(v) = &meta.value {
                c.owner = Some(
                    v.to_string()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
        }
        "seeds" => {
            if let Some(v) = &meta.value {
                c.seeds = parse_seed_array(v.clone());
            }
        }
        _ => {
            if key.starts_with("token::") || key == "token" {
                c.token = true;
            }
            if key.starts_with("associated_token::") || key == "associated_token" {
                c.associated_token = true;
            }
            if key.starts_with("realloc::") {
                c.realloc = true;
            }
        }
    }
}

/// Parse the `[ ... ]` value of a `seeds = [...]` constraint into one string
/// per top-level element.
fn parse_seed_array(tokens: proc_macro2::TokenStream) -> Vec<String> {
    use proc_macro2::TokenTree;

    // The value should be a single bracket Group; unwrap it if so.
    let inner = {
        let mut iter = tokens.clone().into_iter();
        match (iter.next(), iter.next()) {
            (Some(TokenTree::Group(g)), None)
                if g.delimiter() == proc_macro2::Delimiter::Bracket =>
            {
                g.stream()
            }
            _ => tokens,
        }
    };

    let mut elems = Vec::new();
    let mut current = proc_macro2::TokenStream::new();
    for tt in inner {
        match &tt {
            TokenTree::Punct(p) if p.as_char() == ',' => {
                let s = current.to_string();
                let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
                if !s.is_empty() {
                    elems.push(s);
                }
                current = proc_macro2::TokenStream::new();
            }
            other => current.extend(std::iter::once(other.clone())),
        }
    }
    let s = current.to_string();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if !s.is_empty() {
        elems.push(s);
    }
    elems
}
