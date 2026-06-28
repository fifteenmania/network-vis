# Network Stack Visualizer

사내망에서 ChatGPT·Claude 등 외부 서비스가 차단됐을 때 **어느 단계에서 막혔는지** 시각적으로 보여주는 진단 도구.  
도메인을 입력하면 연결 과정 전체를 3D 지구본과 패널로 실시간 추적합니다.

![메인 화면](docs/screenshot-globe.png)

---

## 인터넷 연결은 4단계를 거칩니다

사내망 방화벽은 이 중 어느 단계에서든 차단할 수 있습니다.

| 단계 | 하는 일 | 막히면 |
|---|---|---|
| **1. DNS** | 도메인 이름(`api.openai.com`)을 서버 주소(IP)로 변환 — 인터넷 전화번호부 | 주소 자체를 못 찾음. 브라우저에 "서버를 찾을 수 없습니다" |
| **2. IP (Traceroute)** | 변환된 IP 주소로 실제 패킷을 전송. 회사 망 → 인터넷 망 순으로 중계 | 특정 IP 대역을 방화벽이 차단. 패킷이 중간에서 사라짐 |
| **3. TLS (HTTPS)** | 브라우저 주소창의 🔒 자물쇠. 서버와 암호화 채널을 수립 | 인증서 오류, 연결 거부. SNI(도메인명)로 차단하는 경우도 여기 |
| **4. HTTP** | 암호화 채널 위에서 실제 요청/응답 | 연결은 됐지만 `403 Forbidden`·`451` 응답 — 콘텐츠 차단 |

---

## 보안 진단 — SSL Inspection 탐지

![보안 진단 패널](docs/screenshot-security.png)

**SSL Inspection**이란 회사 방화벽이 암호화된 HTTPS 통신을 중간에서 풀어서 내용을 검사하는 기술입니다.  
사용자 눈에는 자물쇠가 그대로 보이지만, 실제로는 방화벽이 내용을 보고 있습니다.

> 비유하자면 — 봉인된 편지를 우체국이 뜯어보고 다시 봉인한 뒤 배달하는 것과 같습니다.  
> 회사는 이 방식으로 보안 위협을 검사하거나, 특정 서비스 이용을 감지합니다.

이 도구는 인증서를 두 번 검증해서 SSL Inspection 여부를 판정합니다.

```
① 전 세계 공인 인증기관(certifi) 목록으로 검증 → 실패
                    ↓
② 내 PC에 설치된 신뢰저장소(사내 CA 포함)로 검증 → 성공
                    ↓
  INTERCEPTED — 방화벽이 TLS를 복호화하는 중
```

① 단계가 성공하면 → `CLEAN` (방화벽 개입 없음)  
② 단계도 실패하면 → 인증서 자체에 문제가 있음

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| **3D 글로브** | 패킷이 지나는 경로(서울 → 시애틀 → 샌프란시스코 등)를 지구본 위 arc로 표시 |
| **DNS 체인** | 루트 서버 → TLD 서버 → 권한 서버까지 이름 변환 과정 단계별 시각화 |
| **Traceroute** | 경유하는 라우터 목록, AS(인터넷 사업자), 응답 시간. 사내 IP는 "내부망"으로 구분 |
| **TLS 핸드셰이크** | 암호화 채널 수립 과정, 사용한 암호 방식, 서버 인증서 정보 |
| **HTTP 프로브** | 실제 요청 결과(상태 코드·헤더). SSL Inspection 환경에서도 정확한 값 반환 |
| **보안 진단** | 차단 레이어 판정 + SSL Inspection 탐지 |
| **다국어** | 한국어 / English |

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

공용 서버에 프론트엔드를 빌드해 올리고, 각 PC에서 백엔드만 실행합니다.

```bash
# .env.local 또는 빌드 시 API 서버 주소 지정
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
