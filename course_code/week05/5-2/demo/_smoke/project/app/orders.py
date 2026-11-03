def list_orders(db, user_id):
    # 缺陷一：没有按调用者过滤；缺陷二：逐单读取明细。
    orders = db.execute("SELECT id, user_id FROM orders ORDER BY id").fetchall()
    result = []
    for order_id, owner in orders:
        items = db.execute(
            "SELECT sku FROM order_items WHERE order_id = ? ORDER BY id", (order_id,)
        ).fetchall()
        result.append({"id": order_id, "user_id": owner, "items": [row[0] for row in items]})
    return result
