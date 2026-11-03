import sqlite3


def list_orders(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute("SELECT id, user_id FROM orders ORDER BY id").fetchall()
    result = []
    for order_id, owner_id in rows:
        items = conn.execute(
            "SELECT sku FROM order_items WHERE order_id = ? ORDER BY sku",
            (order_id,),
        ).fetchall()
        result.append({
            "id": order_id,
            "user_id": owner_id,
            "items": [row[0] for row in items],
        })
    return result
