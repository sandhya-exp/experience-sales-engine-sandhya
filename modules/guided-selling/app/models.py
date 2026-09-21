from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


SignStep = Literal[
    "Draft",
    "Sent to Customer",
    "Customer Signed",
    "Experience.com Countersigned",
    "Fully Executed",
]


class Contact(BaseModel):
    name: str
    role: str
    is_signer: bool = False
    email: str = ""


class Deal(BaseModel):
    id: str
    name: str
    status: str


class Contract(BaseModel):
    name: str = "Experience.com Agreement"
    status: SignStep = "Draft"
    generated: bool = False
    term_start: date
    term_end: date
    quote_amount: str = "$48,000 / year"


class Document(BaseModel):
    name: str
    type: str
    version: str
    created: str
    status: str
    signed: str
    expiry: str
    filename: Optional[str] = None
    download_url: Optional[str] = None


class Activity(BaseModel):
    at: str
    text: str


class Customer(BaseModel):
    id: str
    name: str
    source_crm: str
    contacts: list[Contact]
    deals: list[Deal]
    contract: Contract
    documents: list[Document]
    activity: list[Activity]


class AccountSummary(BaseModel):
    id: str
    name: str
    source_crm: str
    contract_name: str


class ClockRequest(BaseModel):
    preset: Literal[
        "start",
        "signing_day_3",
        "renewal_window",
        "day_21",
        "day_14",
        "day_7",
    ] = Field(
        ...,
        description="start = 18 Sep 2026; signing_day_3 = signature reminder; renewal presets = expiry nudges",
    )


class SelectAccountRequest(BaseModel):
    customer_id: str


# "Experience.com" = an opportunity qualified in the Lead & Deal Workspace (native intake, no external CRM).
CrmSource = Literal["Encompass", "BytePro", "Total Expert", "AgencyZoom", "Experience.com"]


class HandoffLead(BaseModel):
    id: str
    source_crm: CrmSource
    company: str
    quote_amount: str
    quote_version: str = "v2"
    status: Literal["queued", "accepted"] = "queued"
    why_qualified: str
    gaps: list[str] = Field(default_factory=list)
    contacts: list[Contact]
    accepted_at: Optional[str] = None
    customer_id: Optional[str] = None
    # Set by the Lead & Deal Workspace handoff: the customer's stated budget, as context only.
    budget_context: Optional[str] = None


class HandoffRun(BaseModel):
    lead_id: str
    customer_id: str
    company: str
    source_crm: str
    contract_name: str
    merged: bool = False
    steps: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class HandoffRequest(BaseModel):
    lead_id: str


class RenewalWatch(BaseModel):
    customer_id: str
    name: str
    source_crm: str
    contract_name: str
    quote_amount: str
    signer: str
    signer_email: str
    term_end: date
    days_until_expiry: int
    status: Literal["watching", "due", "snoozed", "open", "expired"]
    nudge_band: Optional[str] = None
    last_nudge_band: Optional[str] = None
    next_nudge: Optional[str] = None
    last_activity: str = ""
    executed: bool = False


class RenewalRun(BaseModel):
    customer_id: str
    company: str
    action: str
    nudge_band: Optional[str] = None
    opened_deal: bool = False
    quote_draft: str = ""
    email_subject: str = ""
    email_body: str = ""
    steps: list[str] = Field(default_factory=list)


class RenewalCopilotRequest(BaseModel):
    customer_id: str
    action: Literal["run", "snooze", "nudge"] = "run"


class ContractPackage(BaseModel):
    id: str
    name: str
    annual_price: int
    display_price: str
    features: list[str]
    best_for: str
    recommended: bool = False


class ContractNegotiation(BaseModel):
    status: Literal["open", "proposed", "agreed"] = "open"
    selected_package_id: str
    selected_package_name: str
    concern: str = ""
    concern_label: str = ""
    concession_percent: int = 0
    list_price: str
    final_price: str
    suggestion: str = ""
    summary: str = ""


class ContractNegotiationRequest(BaseModel):
    package_id: str
    concern: Literal["budget", "implementation", "legal", "features", "none"] = "none"
    concession_percent: int = Field(default=0, ge=0, le=15)
    action: Literal["propose", "finalize"] = "propose"


class SigningWatch(BaseModel):
    status: Literal[
        "not_sent",
        "waiting_customer",
        "customer_signed",
        "countersigned",
        "fully_executed",
    ]
    signer: str
    signer_email: str
    sent_at: Optional[datetime] = None
    days_waiting: int = 0
    reminder_due_at: Optional[datetime] = None
    reminder_due: bool = False
    reminder_sent_at: Optional[datetime] = None
    reminder_count: int = 0


class AppState(BaseModel):
    now: datetime
    sign_index: int = 0
    contract_generated: bool = False
    renewal_started: bool = False
    customer: Customer
    customers: list[AccountSummary] = Field(default_factory=list)
    days_until_expiry: int = 0
    renewal_due: bool = False
    inbox: list[HandoffLead] = Field(default_factory=list)
    last_handoff: Optional[HandoffRun] = None
    watchlist: list[RenewalWatch] = Field(default_factory=list)
    last_renewal: Optional[RenewalRun] = None
    contract_packages: list[ContractPackage] = Field(default_factory=list)
    negotiation: ContractNegotiation
    signing_watch: SigningWatch
