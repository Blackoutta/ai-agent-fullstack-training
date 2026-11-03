import sqlite3
import unittest
from app.orders import list_orders

class OrderTests(unittest.TestCase):
    def test_list_not_empty(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("""
        CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER);
        CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, sku TEXT);
        INSERT INTO orders VALUES(100, 10);
        INSERT INTO order_items VALUES(1, 100, 'book');
        """)
        self.assertTrue(list_orders(db, 10))
