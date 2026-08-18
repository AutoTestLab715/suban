import os
import sys
import unittest
import types
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("CONTACT_EXPORT_SECRET", "test-secret")
os.environ.setdefault("CONTACT_EXPORT_PASSWORD", "test-password")
os.environ.setdefault("CONTACT_EXPORT_USER", "admin")
sys.modules.setdefault("pymysql", types.SimpleNamespace(connect=lambda **kwargs: None, cursors=types.SimpleNamespace(DictCursor=object)))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as contact_app

SAMPLE = {
    "items": [
        {"purchaser":"有电话单位","phones":["0591-12345678"],"emails":[],"contact_people":["林老师"],"addresses":[],"notice_count":1,"contact_notice_count":1,"latest_title":"测试公告","latest_date":"2026-07-23","latest_url":"","region":"福建","confidence":"高","match_basis":"采购人信息","evidence":"联系方式：0591-12345678","has_contact":True},
        {"purchaser":"无电话单位","phones":[],"emails":[],"contact_people":[],"addresses":[],"notice_count":1,"contact_notice_count":0,"latest_title":"另一公告","latest_date":"2026-07-22","latest_url":"","region":"福建","confidence":"未提取","match_basis":"","evidence":"","has_contact":False},
    ],
    "matched_notices": 2,
    "extracted_notices": 1,
    "unit_count": 2,
    "unit_with_contact": 1,
    "truncated": False,
}

class AppTests(unittest.TestCase):
    def setUp(self):
        contact_app.app.config.update(TESTING=True)
        self.client = contact_app.app.test_client()

    def login(self):
        with self.client.session_transaction() as session:
            session["authenticated"] = True

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(200, response.status_code)
        self.assertEqual("biaoxun-contact-center", response.get_json()["service"])

    def test_home_requires_login(self):
        self.assertEqual(302, self.client.get("/").status_code)

    @patch.object(contact_app, "search_contacts", return_value=SAMPLE)
    def test_default_hides_units_without_contact(self, _mock):
        self.login()
        html = self.client.get("/?keyword=医院").get_data(as_text=True)
        self.assertIn("有电话单位", html)
        self.assertNotIn("无电话单位", html)
        self.assertIn("有效联系方式", html)

    @patch.object(contact_app, "search_contacts", return_value=SAMPLE)
    def test_all_scope_shows_all_units(self, _mock):
        self.login()
        html = self.client.get("/?keyword=医院&contact_scope=all").get_data(as_text=True)
        self.assertIn("有电话单位", html)
        self.assertIn("无电话单位", html)

    @patch.object(contact_app, "search_contacts", return_value=SAMPLE)
    def test_csv_default_exports_contacts_only(self, _mock):
        self.login()
        text = self.client.get("/export.csv?keyword=医院").get_data(as_text=True)
        self.assertIn("有电话单位", text)
        self.assertNotIn("无电话单位", text)

if __name__ == "__main__":
    unittest.main()

