import unittest

from collect import choose_best, median
from proxylib import obfuscated_init, parse_host_ports, parse_mtproto, split_mtproto_secret
from vlesslib import parse_vless
from xraycfg import outbound


SAMPLE = (
    "vless://11111111-2222-3333-4444-555555555555@nl.example.com:443"
    "?encryption=none&security=reality&sni=www.example.com&fp=chrome"
    "&pbk=abc&sid=def&type=tcp&flow=xtls-rprx-vision#nl"
)


class XrayConfigTests(unittest.TestCase):
    def test_reality_outbound_uses_public_key(self):
        config = parse_vless(SAMPLE)
        assert config is not None
        built = outbound(config, "out-0")
        assert built is not None
        self.assertEqual(built["protocol"], "vless")
        self.assertEqual(built["streamSettings"]["security"], "reality")
        self.assertEqual(built["streamSettings"]["realitySettings"]["publicKey"], "abc")
        self.assertEqual(built["settings"]["vnext"][0]["users"][0]["flow"], "xtls-rprx-vision")

    def test_reality_without_key_is_skipped(self):
        config = parse_vless(
            "vless://11111111-2222-3333-4444-555555555555@h.example:443?type=tcp&security=reality&sni=a.com"
        )
        assert config is not None
        self.assertIsNone(outbound(config, "out"))


class BestTests(unittest.TestCase):
    def test_lowest_delay_then_more_successes(self):
        slow = {"id": "a", "check": "real", "delay_ms": 40, "successes": 3}
        fast_unstable = {"id": "b", "check": "real", "delay_ms": 20, "successes": 1}
        fast_stable = {"id": "c", "check": "real", "delay_ms": 20, "successes": 3}
        tcp = {"id": "d", "check": "tcp", "delay_ms": 1, "successes": 1}
        chosen = choose_best([slow, fast_unstable, fast_stable, tcp])
        assert chosen is not None
        self.assertEqual(chosen["id"], "c")

    def test_median_even(self):
        self.assertEqual(median([10, 30]), 20)
        self.assertIsNone(median([]))


class ProxyParseTests(unittest.TestCase):
    def test_mtproto_link_and_secret(self):
        payload = "https://t.me/proxy?server=ex.test.&port=443&secret=dd10400103324995b07c030386e886e7f1\n"
        parsed = parse_mtproto(payload, "src")
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["host"], "ex.test")
        self.assertEqual(parsed[0]["port"], 443)
        self.assertTrue(parsed[0]["uri"].startswith("tg://proxy?"))
        split = split_mtproto_secret(parsed[0]["secret"])
        assert split is not None
        self.assertEqual(split[0], "secured")
        self.assertEqual(len(split[1]), 16)

    def test_faketls_domain(self):
        domain = "www.example.com".encode().hex()
        secret = "ee" + "ab" * 16 + domain
        split = split_mtproto_secret(secret)
        assert split is not None
        self.assertEqual(split[0], "faketls")
        self.assertEqual(split[2], "www.example.com")

    def test_socks_lines(self):
        parsed = parse_host_ports("1.2.3.4:1080\n# c\n127.0.0.1:1\n", "socks5", "src")
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["uri"], "socks5://1.2.3.4:1080")

    def test_obfuscated_init_is_64_bytes(self):
        payload = obfuscated_init(bytes.fromhex("10400103324995b07c030386e886e7f1"))
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(len(payload), 64)
        self.assertNotEqual(payload[0], 0xEF)


if __name__ == "__main__":
    unittest.main()
