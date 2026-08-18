import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extractor import extract_purchaser_contact


class ExtractorTests(unittest.TestCase):
    def test_standard_purchaser_section_does_not_take_agency_phone(self):
        row = {
            "purchaser": "福建医科大学",
            "content_text": "九、联系方式 1.采购人信息 名称：福建医科大学 地址：福州市大学新区 联系方式：0591-12345678 2.采购代理机构信息 名称：测试代理公司 地址：福州市鼓楼区 联系方式：13800138000 3.项目联系方式 项目联系人：张三 电话：13800138000",
        }
        got = extract_purchaser_contact(row)
        self.assertIn("0591-12345678", got["phones"])
        self.assertNotIn("13800138000", got["phones"])
        self.assertEqual("高", got["confidence"])

    def test_contract_party_a(self):
        row = {
            "purchaser": "某某学校",
            "content_text": "采购人(甲方)：某某学校 地址：福建省泉州市 联系方式：13712345678 供应商(乙方)：某某科技有限公司 地址：厦门市 联系方式：13912345678",
        }
        got = extract_purchaser_contact(row)
        self.assertEqual(["13712345678"], got["phones"])
        self.assertIn("福建省泉州市", got["addresses"])

    def test_name_inside_contact_value(self):
        row = {
            "purchaser": "某医院",
            "content_text": "1.采购人信息 名称：某医院 地址：福州市 联系方式：林老师/0591-86218319 2.采购代理机构信息 名称：代理公司 联系方式：13800138000",
        }
        got = extract_purchaser_contact(row)
        self.assertIn("林老师", got["contact_people"])
        self.assertEqual(["0591-86218319"], got["phones"])

    def test_unit_nearby_contact(self):
        row = {
            "purchaser": "平潭综合实验区医院",
            "content_text": "本项目采购单位为平潭综合实验区医院，联系人：林女士 联系电话：0591-87654321。其他事项另行通知。",
        }
        got = extract_purchaser_contact(row)
        self.assertIn("0591-87654321", got["phones"])
        self.assertIn("林女士", got["contact_people"])

    def test_no_global_agency_fallback_when_purchaser_is_absent(self):
        row = {
            "purchaser": "不存在的甲方单位",
            "content_text": "采购代理机构：某代理公司 联系方式：13800138000",
        }
        got = extract_purchaser_contact(row)
        self.assertFalse(got["has_contact"])


    def test_procurement_unit_and_procurement_agency_sections(self):
        row = {
            "purchaser": "安溪县教育局",
            "content_text": "九、联系方式 1.采购单位信息 名称：安溪县教育局 地址：安溪县行政中心 联系方式：0595-23288343 2.采购机构信息 名称：某工程公司 地址：泉州市 联系方式：13400870168",
        }
        got = extract_purchaser_contact(row)
        self.assertEqual(["0595-23288343"], got["phones"])
        self.assertEqual(["安溪县行政中心"], got["addresses"])


if __name__ == "__main__":
    unittest.main()
