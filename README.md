# Network Stack Visualizer

회사에서 특정 사이트가 막혔을 때, 어디서 막혔는지 보여주는 도구.

![메인 화면](docs/screenshot-globe.png)

---

## 왜 "어디서"가 중요한가

"안 된다"는 증상은 같아도 막힌 위치가 다르면 이유도, 해결 방법도 다르다.

**주소를 못 찾는 경우** — 회사 네트워크가 그 사이트의 이름 자체를 차단했다.
도메인을 입력해도 아무 서버로도 연결이 안 된다.

**길목을 막은 경우** — 주소는 찾았는데 데이터가 가는 길이 막혔다.
어느 구간에서 차단됐는지, 어느 회사 망을 지나다 막혔는지 보인다.

**암호화 구간에서 막힌 경우** — 사이트에 거의 다 왔는데 보안 연결 수립 단계에서 차단됐다.
사이트 이름 자체로 걸러내는 방식이다.

**콘텐츠 차단** — 연결은 됐는데 서버가 "접근 거부" 응답을 보낸다.

---

## 감청 탐지

연결 자체는 된다. 그런데 회사 방화벽이 중간에서 내용을 보고 있을 수 있다.

자물쇠(HTTPS)가 걸려 있어도, 회사 PC에는 이미 회사 인증서가 심어져 있어서
방화벽이 암호를 풀었다가 다시 잠글 수 있다. 사용자는 눈치채기 어렵다.

이 도구는 그 인증서가 전 세계 공인기관이 발급한 것인지,
사내에서 만든 것인지를 비교해서 감청 여부를 판정한다.

![보안 진단 패널](docs/screenshot-security.png)

---

## 기술 스택

**Backend** — Python 3.13+, FastAPI, certifi, truststore  
**Frontend** — React 19, TypeScript, Vite, Three.js, Zustand

---

## 셋업

### 사전 요구사항

- [uv](https://docs.astral.sh/uv/) — Python 패키지 매니저
- Node.js 20+
- Windows: `tracert` 기본 포함 / macOS·Linux: `traceroute` 설치 필요

### 실행

```bash
# 백엔드
uv sync
uv run uvicorn main:app --reload --port 8000

# 프론트엔드 (별도 터미널)
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 후 도메인 입력.

### 팀 공유 시

공용 서버에 프론트엔드를 빌드해 올리고, 각 PC에서 백엔드만 실행.

```bash
VITE_API_BASE=http://your-server:8000/api npm run build
```

### 테스트

```bash
uv run pytest -q
```

---

## API 엔드포인트

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/dns?host=` | DNS 체인 + GeoIP |
| `GET /api/traceroute?host=` | Traceroute SSE 스트리밍 |
| `GET /api/tls?host=` | TLS 핸드셰이크 + 인증서 + SSL Inspection 진단 |
| `GET /api/http?host=` | HTTP 프로브 |
| `GET /health` | 헬스 체크 |

---

## 프로젝트 구조

```
network-vis/
├── main.py
├── api/
│   ├── router.py        # API 엔드포인트
│   ├── dns_lookup.py    # DNS 재귀 체인
│   ├── traceroute.py    # Traceroute 스트리밍 + GeoIP
│   ├── tls.py           # TLS + 신뢰저장소 이중 검증
│   ├── http_probe.py    # HTTP 프로브
│   ├── mitm.py          # SSL Inspection 탐지
│   ├── geo.py           # GeoIP
│   └── ipclass.py       # 사설 IP 분류
├── tests/
└── frontend/
```

---

## 라이선스

MIT
