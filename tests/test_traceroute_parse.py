"""
Windows tracert 출력 파싱 및 사설 IP 분류 단위 테스트.

한국어 Windows에서는 타임아웃 메시지가 현지화("요청 시간이 만료되었습니다.")되므로
영문 "timed out" 문자열에 의존하지 않고, IP 미검출 시 빈 홉으로 처리되는지 검증합니다.
"""

from api.traceroute import _parse_line_windows
from api.ipclass import is_internal_ip


def test_windows_normal_hop():
    line = "  2    10 ms     9 ms    11 ms  203.0.113.5"
    assert _parse_line_windows(line) == (2, "203.0.113.5", [10.0, 9.0, 11.0])


def test_windows_sub_ms_hop():
    # "<1 ms"(1밀리초 미만) 표기는 1.0ms로 캡처되어야 한다.
    line = "  1    <1 ms    <1 ms    <1 ms  192.168.0.1"
    hop, ip, rtts = _parse_line_windows(line)
    assert hop == 1
    assert ip == "192.168.0.1"
    assert rtts == [1.0, 1.0, 1.0]


def test_windows_timeout_english():
    line = "  3     *        *        *     Request timed out."
    assert _parse_line_windows(line) == (3, "", [])


def test_windows_timeout_korean():
    # 한국어 Windows: 메시지가 현지화돼도 IP가 없으므로 빈 홉으로 처리되어야 한다.
    line = "  3     *        *        *     요청 시간이 만료되었습니다."
    assert _parse_line_windows(line) == (3, "", [])


def test_windows_header_line_ignored():
    assert _parse_line_windows("최대 30개의 홉 이상에 대해 경로를 추적합니다.") is None


def test_is_internal_ip_private():
    assert is_internal_ip("192.168.0.1")
    assert is_internal_ip("10.0.0.5")
    assert is_internal_ip("172.16.3.4")
    assert is_internal_ip("127.0.0.1")


def test_is_internal_ip_public():
    assert not is_internal_ip("8.8.8.8")
    assert not is_internal_ip("1.1.1.1")
    assert not is_internal_ip("not-an-ip")
