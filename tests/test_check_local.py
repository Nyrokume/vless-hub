import json

from vlesshub.cli import main
from vlesshub.localcheck import configs_from_hub

URI = "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none#a"


def test_configs_from_hub_keeps_one_valid_uri():
    found = configs_from_hub(
        {
            "configs": [
                {"uri": URI},
                {"uri": "not-a-link"},
                {"host": "9.9.9.9"},
                "junk",
            ]
        }
    )
    assert len(found) == 1
    assert found[0].host == "1.2.3.4"
    assert found[0].port == 443
    assert found[0].raw.startswith("vless://")


def test_configs_from_hub_rejects_non_objects():
    assert configs_from_hub([]) == []
    assert configs_from_hub({"configs": "nope"}) == []


def test_check_local_list_only_prints_endpoint(tmp_path, capsys):
    path = tmp_path / "configs.json"
    path.write_text(
        json.dumps(
            {
                "configs": [
                    {"uri": URI},
                    {"uri": "vmess://not-supported"},
                ]
            }
        ),
        encoding="utf-8",
    )
    code = main(["check-local", "--file", str(path), "--list-only"])
    output = capsys.readouterr().out
    assert code == 0
    assert "1.2.3.4:443" in output
    assert "vmess" not in output
