import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.models import (
    AppState,
    ClockRequest,
    ContractNegotiationRequest,
    HandoffRequest,
    RenewalCopilotRequest,
    SelectAccountRequest,
)
from app.inbound import InboundHandoff, lead_from_payload
from app.models import HandoffLead
from app.store import store

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(
    title="Experience.com Sales Engine",
    description="Quote → contract → signature → renewal on a single customer record.",
    version="1.0.0",
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "sales-engine"}


@app.get("/api/state", response_model=AppState)
def get_state() -> AppState:
    return store.snapshot()


@app.post("/api/reset", response_model=AppState)
def reset() -> AppState:
    return store.reset()


@app.post("/api/clock", response_model=AppState)
def set_clock(body: ClockRequest) -> AppState:
    return store.set_clock(body.preset)


@app.post("/api/account/select", response_model=AppState)
def select_account(body: SelectAccountRequest) -> AppState:
    return store.select_account(body.customer_id)


# Inbound push from the Lead & Deal Workspace when a deal is confirmed.
# Shared secret: HANDOFF_API_KEY on both sides (header X-Sales-Engine-Key).
@app.post("/api/handoffs", response_model=HandoffLead, status_code=202)
def receive_handoff(
    payload: InboundHandoff,
    x_sales_engine_key: str | None = Header(default=None, alias="X-Sales-Engine-Key"),
) -> HandoffLead:
    expected = os.environ.get("HANDOFF_API_KEY")
    if expected and x_sales_engine_key != expected:
        raise HTTPException(status_code=401, detail="Invalid X-Sales-Engine-Key")
    return store.enqueue_handoff(lead_from_payload(payload))


@app.get("/api/handoffs/{lead_id}", response_model=HandoffLead)
def get_handoff(lead_id: str) -> HandoffLead:
    lead = next((item for item in store.inbox if item.id == lead_id or item.id == f"se-{lead_id}"), None)
    if lead is None:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return lead


@app.post("/api/handoff/accept", response_model=AppState)
def accept_handoff(body: HandoffRequest) -> AppState:
    return store.accept_handoff(body.lead_id)


@app.post("/api/contract/generate", response_model=AppState)
def generate_contract() -> AppState:
    return store.generate_contract()


@app.post("/api/contract/negotiate", response_model=AppState)
def negotiate_contract(body: ContractNegotiationRequest) -> AppState:
    return store.negotiate_contract(
        body.package_id,
        body.concern,
        body.concession_percent,
        body.action,
    )


@app.post("/api/contract/send", response_model=AppState)
def send_for_signature() -> AppState:
    return store.send_for_signature()


@app.post("/api/signing/advance", response_model=AppState)
def advance_signing() -> AppState:
    return store.advance_signing()


@app.post("/api/renewal/start", response_model=AppState)
def start_renewal() -> AppState:
    return store.start_renewal()


@app.post("/api/renewal/copilot", response_model=AppState)
def renewal_copilot(body: RenewalCopilotRequest) -> AppState:
    return store.run_renewal_copilot(body.customer_id, body.action)


@app.get("/api/documents/{customer_id}/executed.pdf")
def download_executed_pdf(customer_id: str) -> FileResponse:
    path = store.executed_pdf(customer_id)
    if path is None:
        raise HTTPException(
            status_code=404,
            detail="The executed PDF is available after both parties have signed.",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=path.name,
        content_disposition_type="inline",
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIST / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")
