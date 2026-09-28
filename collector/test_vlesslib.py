import unittest

from vlesslib import dedupe, extract_flag_code, extract_vless_uris, parse_vless


SAMPLE = (
    "vless://11111111-2222-3333-4444-555555555555@nl.example.com:443"
    "?encryption=none&security=reality&sni=www.example.com&fp=chrome"
    "&pbk=abc&sid=def&type=tcp&flow=xtls-rprx-vision"
    "#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B"
)


class ParseTests(unittest.TestCase):
    def test_parses_reality_tcp_and_flag(self):
        config = parse_vless(SAMPLE, "test")
        self.assertIsNotNone(config)
        assert config is not None
        self.assertEqual(config["host"], "nl.example.com")
        self.assertEqual(config["port"], 443)
        self.assertEqual(config["transport"], "tcp")
        self.assertEqual(config["security"], "reality")
        self.assertEqual(config["sni"], "www.example.com")
        self.assertEqual(config["flow"], "xtls-rprx-vision")
        self.assertEqual(config["country_code"], "NL")
        self.assertEqual(config["country"], "Нидерланды")
        self.assertEqual(config["country_source"], "remark")
        self.assertEqual(config["source"], "test")

    def test_parses_ws_path_and_host_header(self):
        uri = (
            "vless://user@1.2.3.4:2086?path=%2Finternet&security=tls"
            "&encryption=none&host=cdn.example&type=ws#plain"
        )
        config = parse_vless(uri)
        assert config is not None
        self.assertEqual(config["transport"], "ws")
        self.assertEqual(config["path"], "/internet")
        self.assertEqual(config["host_header"], "cdn.example")
        self.assertEqual(config["security"], "tls")
        self.assertIsNone(config["country_code"])

    def test_parses_ipv6(self):
        uri = "vless://user@[2001:db8::1]:8443?type=grpc&serviceName=api&security=tls#node"
        config = parse_vless(uri)
        assert config is not None
        self.assertEqual(config["host"], "2001:db8::1")
        self.assertEqual(config["port"], 8443)
        self.assertEqual(config["service_name"], "api")

    def test_rejects_junk(self):
        self.assertIsNone(parse_vless("vmess://abc"))
        self.assertIsNone(parse_vless("vless://user@localhost:443?type=tcp"))
        self.assertIsNone(parse_vless("vless://user@example.com:99999?type=tcp"))
        self.assertIsNone(parse_vless("not a link"))

    def test_extracts_from_base64_body(self):
        import base64

        encoded = base64.b64encode(SAMPLE.encode()).decode()
        uris = extract_vless_uris(encoded)
        self.assertEqual(uris, [SAMPLE])

    def test_extracts_plain_lines_and_skips_headers(self):
        body = "#profile-title: x\nvmess://nope\n" + SAMPLE + "\n"
        self.assertEqual(extract_vless_uris(body), [SAMPLE])

    def test_dedupe_prefers_flagged_remark(self):
        first = parse_vless(
            "vless://user@1.1.1.1:443?type=tcp&security=none#plain",
            "a",
        )
        second = parse_vless(
            "vless://user@1.1.1.1:443?type=tcp&security=none#%F0%9F%87%A9%F0%9F%87%AA",
            "b",
        )
        assert first and second
        merged = dedupe([first, second])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["country_code"], "DE")

    def test_flag_helper(self):
        self.assertEqual(extract_flag_code("prefix 🇪🇪 tail"), "EE")
        self.assertIsNone(extract_flag_code("no flag"))


if __name__ == "__main__":
    unittest.main()
