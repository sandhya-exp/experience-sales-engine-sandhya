from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from app.pdf_contract import executed_pdf_path, write_executed_pdf
from app.models import (
    AccountSummary,
    Activity,
    AppState,
    Contact,
    Contract,
    ContractNegotiation,
    ContractPackage,
    Customer,
    Deal,
    Document,
    HandoffLead,
    HandoffRun,
    RenewalRun,
    RenewalWatch,
    SigningWatch,
)

START = datetime(2026, 9, 18, 9, 0, 0)
RENEWAL_WINDOW = datetime(2027, 8, 18, 9, 0, 0)
DAY_21 = datetime(2027, 8, 27, 9, 0, 0)
DAY_14 = datetime(2027, 9, 3, 9, 0, 0)
DAY_7 = datetime(2027, 9, 10, 9, 0, 0)
CONTRACT_START = date(2026, 9, 18)
CONTRACT_END = date(2027, 9, 17)

CLOCK = {
    "start": START,
    "signing_day_3": START + timedelta(days=3),
    "renewal_window": RENEWAL_WINDOW,
    "day_21": DAY_21,
    "day_14": DAY_14,
    "day_7": DAY_7,
}

NEXT_BAND = {"30": "21", "21": "14", "14": "7", "7": None}

AGREEMENT_BY_CRM = {
    "Encompass": "Encompass Agreement",
    "Total Expert": "Experience.com Agreement",
    "BytePro": "Experience.com Agreement",
    "AgencyZoom": "Experience.com Agreement",
    "Experience.com": "Experience.com Agreement",
}

PACKAGE_CATALOG = {
    "Total Expert": [
        ("te-essential", "Essential", 36000, ["Reputation management", "Surveys", "Standard support"], "Teams starting with core customer experience"),
        ("te-growth", "Growth", 48000, ["Reputation management", "Surveys", "Workflow automation", "Total Expert sync", "Priority support"], "Revenue teams needing CRM-connected workflows"),
        ("te-enterprise", "Enterprise", 66000, ["Everything in Growth", "Advanced analytics", "Multi-brand controls", "Dedicated success manager", "Custom workflows"], "Large organizations with governance needs"),
    ],
    "Encompass": [
        ("enc-core", "Lending Core", 32000, ["Borrower surveys", "Review generation", "Encompass milestone sync"], "Mortgage teams beginning post-close automation"),
        ("enc-growth", "Lending Growth", 45000, ["Everything in Core", "Branch dashboards", "Loan officer workflows", "Priority support"], "Multi-branch lenders focused on growth"),
        ("enc-enterprise", "Lending Enterprise", 62000, ["Everything in Growth", "Enterprise analytics", "Custom Encompass events", "Dedicated success manager"], "Enterprise lenders with complex LOS operations"),
    ],
    "BytePro": [
        ("bp-core", "Core", 24000, ["Customer surveys", "Review requests", "BytePro sync"], "Independent mortgage teams"),
        ("bp-growth", "Growth", 36000, ["Everything in Core", "Automated workflows", "Team analytics", "Priority support"], "Growing origination teams"),
        ("bp-enterprise", "Enterprise", 52000, ["Everything in Growth", "Custom reporting", "Multi-entity controls", "Dedicated success manager"], "Large lenders"),
    ],
    "AgencyZoom": [
        ("az-core", "Agency Core", 18500, ["Policyholder surveys", "Review requests", "AgencyZoom sync"], "Independent agencies"),
        ("az-growth", "Agency Growth", 28000, ["Everything in Core", "Renewal workflows", "Producer analytics", "Priority support"], "Growing agencies"),
        ("az-enterprise", "Agency Enterprise", 42000, ["Everything in Growth", "Multi-office controls", "Custom workflows", "Dedicated success manager"], "Agency groups"),
    ],
}


def _slug(name: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned or "customer"


def _fmt(d: date | datetime) -> str:
    if isinstance(d, datetime):
        return d.strftime("%d %b %Y")
    return d.strftime("%d %b %Y")


def _stamp(now: datetime) -> str:
    return now.strftime("%d %b %Y %H:%M")


def _signer(customer: Customer) -> Contact:
    for person in customer.contacts:
        if person.is_signer:
            return person
    return customer.contacts[0]


def _nudge_band(days: int) -> Optional[str]:
    if days <= 0:
        return None
    if days <= 7:
        return "7"
    if days <= 14:
        return "14"
    if days <= 21:
        return "21"
    if days <= 30:
        return "30"
    return None


def _band_label(band: Optional[str]) -> str:
    return {
        "30": "30-day notice",
        "21": "21-day follow-up",
        "14": "14-day warning",
        "7": "7-day final notice",
    }.get(band or "", "")


def _usd_year(n: int) -> str:
    return f"${int(n):,} / year"


def _as_usd_quote(amount: str) -> str:
    if "₹" not in amount and "Rs" not in amount:
        return amount
    value = _money_value(amount)
    if value >= 100000:
        value = round(value / 10)
    return _usd_year(value)


def _uplift(quote: str) -> str:
    digits = "".join(ch for ch in quote if ch.isdigit())
    if not digits:
        return quote
    return _usd_year(round(int(digits) * 1.05))


def _money_value(amount: str) -> int:
    digits = "".join(ch for ch in amount if ch.isdigit())
    return int(digits) if digits else 0


def _packages(account: Account) -> list[ContractPackage]:
    customer = account.customer
    rows = PACKAGE_CATALOG.get(customer.source_crm, PACKAGE_CATALOG["Total Expert"])
    current = _money_value(customer.contract.quote_amount)
    closest = min(rows, key=lambda row: abs(row[2] - current))[0]
    return [
        ContractPackage(
            id=package_id,
            name=name,
            annual_price=price,
            display_price=_usd_year(price),
            features=features,
            best_for=best_for,
            recommended=package_id == closest,
        )
        for package_id, name, price, features, best_for in rows
    ]


def _quoted_package(account: Account) -> ContractPackage:
    packages = _packages(account)
    return next(item for item in packages if item.recommended)


def _lock_quoted_offer(account: Account) -> ContractPackage:
    selected = _quoted_package(account)
    account.selected_package_id = selected.id
    account.concern = "none"
    account.concession_percent = 0
    account.negotiation_status = "agreed"
    account.negotiation_suggestion = ""
    account.negotiation_summary = f"{selected.name} · quoted {account.customer.contract.quote_amount}"
    return selected


def _negotiation(account: Account) -> ContractNegotiation:
    selected = _quoted_package(account)
    if not account.selected_package_id:
        account.selected_package_id = selected.id
    if not account.negotiation_summary:
        account.negotiation_summary = f"{selected.name} · quoted {account.customer.contract.quote_amount}"
    return ContractNegotiation(
        status="agreed",
        selected_package_id=selected.id,
        selected_package_name=selected.name,
        concern="none",
        concern_label="Quoted terms",
        concession_percent=0,
        list_price=selected.display_price,
        final_price=account.customer.contract.quote_amount,
        suggestion="",
        summary=account.negotiation_summary,
    )


def _signing_watch(account: Account, now: datetime) -> SigningWatch:
    customer = account.customer
    signer = _signer(customer)
    statuses = {
        0: "not_sent",
        1: "waiting_customer",
        2: "customer_signed",
        3: "countersigned",
        4: "fully_executed",
    }
    reminder_due_at = (
        account.sent_at + timedelta(days=3) if account.sent_at is not None else None
    )
    days_waiting = (
        max(0, (now.date() - account.sent_at.date()).days)
        if account.sent_at is not None and account.sign_index == 1
        else 0
    )
    return SigningWatch(
        status=statuses[account.sign_index],
        signer=signer.name,
        signer_email=signer.email,
        sent_at=account.sent_at,
        days_waiting=days_waiting,
        reminder_due_at=reminder_due_at,
        reminder_due=(
            account.sign_index == 1
            and reminder_due_at is not None
            and now >= reminder_due_at
            and account.reminder_sent_at is None
        ),
        reminder_sent_at=account.reminder_sent_at,
        reminder_count=account.reminder_count,
    )


@dataclass
class Account:
    customer: Customer
    sign_index: int = 0
    contract_generated: bool = False
    renewal_started: bool = False
    days_until_expiry: int = 0
    renewal_due: bool = False
    quote_created: str = "12 Sep 2026"
    quote_accepted: str = "18 Sep 2026"
    quote_expiry: str = "12 Oct 2026"
    snoozed: bool = False
    last_nudge_band: Optional[str] = None
    quote_draft: str = ""
    email_subject: str = ""
    email_body: str = ""
    selected_package_id: str = ""
    concern: str = "none"
    concession_percent: int = 0
    negotiation_status: str = "open"
    negotiation_suggestion: str = ""
    negotiation_summary: str = ""
    sent_at: Optional[datetime] = None
    reminder_sent_at: Optional[datetime] = None
    reminder_count: int = 0


def _watch_status(account: Account) -> str:
    days = account.days_until_expiry
    if account.renewal_started:
        return "open"
    if days <= 0:
        return "expired"
    if days > 30:
        return "watching"
    if account.snoozed:
        return "snoozed"
    return "due"


def _next_nudge_label(account: Account) -> Optional[str]:
    band = _nudge_band(account.days_until_expiry)
    if account.renewal_started or not band:
        return None
    if account.snoozed:
        nxt = NEXT_BAND.get(account.last_nudge_band or band)
        return _band_label(nxt) if nxt else "Term end"
    return _band_label(band)


def _email_for(account: Account, band: str, quote_draft: str) -> tuple[str, str]:
    customer = account.customer
    signer = _signer(customer)
    days = account.days_until_expiry
    end = _fmt(customer.contract.term_end)
    name = signer.name.split()[0]
    subjects = {
        "30": f"{customer.name} · {customer.contract.name} renews in {days} days",
        "21": f"Following up: {customer.name} renewal — {days} days left",
        "14": f"Two weeks left: {customer.name} {customer.contract.name}",
        "7": f"Final notice: {customer.name} term ends {end}",
    }
    intros = {
        "30": f"Your {customer.contract.name} term ends on {end}. Thirty-day notice is due now.",
        "21": f"Checking in — we snoozed this last week. The {customer.contract.name} still ends on {end}.",
        "14": f"Two weeks remain on the current term ({end}). We should lock Renewal 2027 this week.",
        "7": f"This is the final notice. {customer.name}'s term ends {end}. After that we are in lapse.",
    }
    body = (
        f"Hi {name},\n\n"
        f"{intros.get(band, intros['30'])}\n\n"
        f"Draft Renewal 2027 quote: {quote_draft} (5% uplift on {customer.contract.quote_amount}).\n"
        f"This stays on the {customer.name} record — we will not open a duplicate account.\n"
        f"Source CRM: {customer.source_crm}. Signer on file: {signer.name}.\n\n"
        f"Reply to confirm and we will generate the renewal paperwork.\n\n"
        f"— Experience.com Sales Engine"
    )
    return subjects.get(band, subjects["30"]), body


def _build_watch(account: Account) -> RenewalWatch:
    customer = account.customer
    signer = _signer(customer)
    band = _nudge_band(account.days_until_expiry)
    last_act = customer.activity[0].text if customer.activity else ""
    return RenewalWatch(
        customer_id=customer.id,
        name=customer.name,
        source_crm=customer.source_crm,
        contract_name=customer.contract.name,
        quote_amount=customer.contract.quote_amount,
        signer=signer.name,
        signer_email=signer.email,
        term_end=customer.contract.term_end,
        days_until_expiry=account.days_until_expiry,
        status=_watch_status(account),
        nudge_band=band,
        last_nudge_band=account.last_nudge_band,
        next_nudge=_next_nudge_label(account),
        last_activity=last_act,
        executed=account.sign_index >= 4,
    )


def _abc() -> Account:
    return Account(
        customer=Customer(
            id="abc-corp",
            name="ABC Corp",
            source_crm="Total Expert",
            contacts=[
                Contact(name="Priya Mehta", role="VP Operations", is_signer=True, email="priya@abccorp.example"),
                Contact(name="Rajesh Iyer", role="Finance", email="rajesh@abccorp.example"),
            ],
            deals=[Deal(id="initial", name="Initial Purchase", status="Quoted")],
            contract=Contract(
                name="Experience.com Agreement",
                term_start=CONTRACT_START,
                term_end=CONTRACT_END,
                quote_amount="$48,000 / year",
            ),
            documents=[],
            activity=[
                Activity(at="18 Sep 2026 09:12", text="Qualified deal handed off from Total Expert."),
                Activity(at="18 Sep 2026 09:18", text="Quote v2 accepted by Priya Mehta."),
            ],
        )
    )


def _xyz() -> Account:
    return Account(
        customer=Customer(
            id="xyz-corp",
            name="XYZ Corp",
            source_crm="Encompass",
            contacts=[
                Contact(name="Sana Kapoor", role="Head of Lending", is_signer=True, email="sana@xyzcorp.example"),
                Contact(name="Arjun Desai", role="Compliance", email="arjun@xyzcorp.example"),
            ],
            deals=[Deal(id="initial", name="Initial Purchase", status="Quoted")],
            contract=Contract(
                name="Encompass Agreement",
                term_start=CONTRACT_START,
                term_end=CONTRACT_END,
                quote_amount="$32,000 / year",
            ),
            documents=[],
            activity=[
                Activity(at="18 Sep 2026 09:08", text="Qualified deal handed off from Encompass."),
                Activity(at="18 Sep 2026 09:22", text="Quote v2 accepted by Sana Kapoor."),
            ],
        )
    )


def _seed_inbox() -> list[HandoffLead]:
    return [
        HandoffLead(
            id="te-abc",
            source_crm="Total Expert",
            company="ABC Corp",
            quote_amount="$48,000 / year",
            status="accepted",
            why_qualified="Quote v2 accepted. Ops signer confirmed. Ready for Experience.com Agreement.",
            contacts=[
                Contact(name="Priya Mehta", role="VP Operations", is_signer=True, email="priya@abccorp.example"),
                Contact(name="Rajesh Iyer", role="Finance", email="rajesh@abccorp.example"),
            ],
            accepted_at="18 Sep 2026 09:12",
            customer_id="abc-corp",
        ),
        HandoffLead(
            id="enc-xyz",
            source_crm="Encompass",
            company="XYZ Corp",
            quote_amount="$32,000 / year",
            status="accepted",
            why_qualified="LOS file complete. Lending head is signer. Map to Encompass Agreement.",
            contacts=[
                Contact(name="Sana Kapoor", role="Head of Lending", is_signer=True, email="sana@xyzcorp.example"),
                Contact(name="Arjun Desai", role="Compliance", email="arjun@xyzcorp.example"),
            ],
            accepted_at="18 Sep 2026 09:08",
            customer_id="xyz-corp",
        ),
        HandoffLead(
            id="bp-pqr",
            source_crm="BytePro",
            company="PQR Lending",
            quote_amount="$24,000 / year",
            why_qualified="Pipeline conversion > 40%. Quote v2 accepted in BytePro. Missing billing contact.",
            gaps=["No billing / AP contact on the file"],
            contacts=[
                Contact(name="Neha Rao", role="COO", is_signer=True, email="neha@pqrlending.example"),
            ],
        ),
        HandoffLead(
            id="az-lakeside",
            source_crm="AgencyZoom",
            company="Lakeside Insurance",
            quote_amount="$18,500 / year",
            why_qualified="Agency book of 1,200 policies. Principal signed the quote in AgencyZoom.",
            contacts=[
                Contact(name="Omar Sheikh", role="Principal", is_signer=True, email="omar@lakeside.example"),
                Contact(name="Leah Kim", role="Office Manager", email="leah@lakeside.example"),
            ],
        ),
        HandoffLead(
            id="enc-northstar",
            source_crm="Encompass",
            company="Northstar Credit Union",
            quote_amount="$51,000 / year",
            why_qualified="Encompass LOS deal won. Credit committee approved. Use Encompass Agreement, not a second Experience.com form.",
            gaps=["Order form not attached in CRM"],
            contacts=[
                Contact(name="Dev Patel", role="SVP Lending", is_signer=True, email="dev@northstar.example"),
                Contact(name="Maya Brooks", role="General Counsel", email="maya@northstar.example"),
            ],
        ),
    ]


def _account_from_lead(lead: HandoffLead, now: datetime) -> Account:
    signer = next((c for c in lead.contacts if c.is_signer), lead.contacts[0])
    cid = lead.customer_id or _slug(lead.company)
    contract_name = AGREEMENT_BY_CRM[lead.source_crm]
    return Account(
        customer=Customer(
            id=cid,
            name=lead.company,
            source_crm=lead.source_crm,
            contacts=list(lead.contacts),
            deals=[Deal(id="initial", name="Initial Purchase", status="Quoted")],
            contract=Contract(
                name=contract_name,
                term_start=CONTRACT_START,
                term_end=CONTRACT_END,
                quote_amount=lead.quote_amount,
            ),
            documents=[],
            activity=[
                Activity(
                    at=_stamp(now),
                    text=f"Handoff agent accepted {lead.source_crm} payload. {lead.why_qualified}",
                ),
                Activity(
                    at=_stamp(now),
                    text=f"Quote {lead.quote_version} accepted by {signer.name}. {contract_name} is the paperwork to generate.",
                ),
            ],
        ),
        quote_created=_fmt(now),
        quote_accepted=_fmt(now),
        quote_expiry="12 Oct 2026",
    )


def _seed_accounts() -> dict[str, Account]:
    return {"abc-corp": _abc(), "xyz-corp": _xyz()}


SIGN_STEPS = [
    "Draft",
    "Sent to Customer",
    "Customer Signed",
    "Experience.com Countersigned",
    "Fully Executed",
]


def _documents(account: Account, now: datetime) -> list[Document]:
    signed = account.sign_index >= 4
    customer = account.customer
    contract = customer.contract
    if account.sign_index == 0:
        contract_status = "Draft" if account.contract_generated else "Pending"
    else:
        contract_status = SIGN_STEPS[min(account.sign_index, 4)]

    return [
        Document(
            name="Quote v1",
            type="Quote",
            version="v1",
            created="04 Sep 2026",
            status="Superseded",
            signed="—",
            expiry="—",
        ),
        Document(
            name="Quote v2",
            type="Quote",
            version="v2",
            created=account.quote_created,
            status="Accepted",
            signed=account.quote_accepted,
            expiry=account.quote_expiry,
        ),
        Document(
            name="Order Form",
            type="Order Form",
            version="v1",
            created=_fmt(CONTRACT_START),
            status="Executed" if signed else "Attached",
            signed=_fmt(contract.term_start) if signed else "—",
            expiry=_fmt(contract.term_end),
        ),
        Document(
            name=contract.name,
            type="Agreement",
            version="v1",
            created=_fmt(START) if account.contract_generated else "—",
            status=contract_status,
            signed=_fmt(now) if account.sign_index >= 2 else "—",
            expiry=_fmt(contract.term_end),
        ),
        Document(
            name="Signed Contract",
            type="Executed Agreement",
            version="v1",
            created=_fmt(now) if signed else "—",
            status="Fully Executed" if signed else "Not created",
            signed=_fmt(now) if signed else "—",
            expiry=_fmt(contract.term_end),
            filename=f"{customer.id}-executed-agreement.pdf" if signed else None,
            download_url=f"/api/documents/{customer.id}/executed.pdf" if signed else None,
        ),
    ]


def _refresh(account: Account, now: datetime) -> Account:
    account.customer.contract.quote_amount = _as_usd_quote(account.customer.contract.quote_amount)
    days = (account.customer.contract.term_end - now.date()).days
    account.days_until_expiry = days
    account.renewal_due = 0 < days <= 30 and not account.renewal_started and not account.snoozed
    account.customer.contract.generated = account.contract_generated
    account.customer.contract.status = SIGN_STEPS[account.sign_index]
    if (
        account.sign_index == 1
        and account.sent_at is not None
        and account.reminder_sent_at is None
        and now >= account.sent_at + timedelta(days=3)
    ):
        signer = _signer(account.customer)
        account.reminder_sent_at = now
        account.reminder_count += 1
        account.customer.activity.insert(
            0,
            Activity(
                at=_stamp(now),
                text=(
                    f"Automatic signature reminder #{account.reminder_count} sent to "
                    f"{signer.name}"
                    + (f" ({signer.email})." if signer.email else ".")
                ),
            ),
        )
    if account.sign_index >= 4:
        for deal in account.customer.deals:
            if deal.id == "initial":
                deal.status = "Won"
    account.customer.documents = _documents(account, now)
    return account


class Store:
    def __init__(self) -> None:
        self.now = START
        self.active_id = "abc-corp"
        self.accounts = _seed_accounts()
        self.inbox = _seed_inbox()
        self.last_handoff: Optional[HandoffRun] = None
        self.last_renewal: Optional[RenewalRun] = None

    def _active(self) -> Account:
        return self.accounts[self.active_id]

    def snapshot(self) -> AppState:
        for account in self.accounts.values():
            _refresh(account, self.now)
        for lead in self.inbox:
            lead.quote_amount = _as_usd_quote(lead.quote_amount)
        acc = self._active()
        return AppState(
            now=self.now,
            sign_index=acc.sign_index,
            contract_generated=acc.contract_generated,
            renewal_started=acc.renewal_started,
            customer=acc.customer,
            customers=[
                AccountSummary(
                    id=a.customer.id,
                    name=a.customer.name,
                    source_crm=a.customer.source_crm,
                    contract_name=a.customer.contract.name,
                )
                for a in self.accounts.values()
            ],
            days_until_expiry=acc.days_until_expiry,
            renewal_due=acc.renewal_due,
            inbox=list(self.inbox),
            last_handoff=self.last_handoff,
            watchlist=[_build_watch(a) for a in self.accounts.values()],
            last_renewal=self.last_renewal,
            contract_packages=_packages(acc),
            negotiation=_negotiation(acc),
            signing_watch=_signing_watch(acc, self.now),
        )

    def reset(self) -> AppState:
        self.now = START
        self.active_id = "abc-corp"
        self.accounts = _seed_accounts()
        self.inbox = _seed_inbox()
        self.last_handoff = None
        self.last_renewal = None
        return self.snapshot()

    def select_account(self, customer_id: str) -> AppState:
        if customer_id in self.accounts:
            self.active_id = customer_id
        return self.snapshot()

    def set_clock(self, preset: str) -> AppState:
        self.now = CLOCK.get(preset, START)
        return self.snapshot()

    def _open_renewal_deal(self, acc: Account) -> bool:
        if acc.renewal_started:
            return False
        acc.renewal_started = True
        acc.snoozed = False
        customer = acc.customer
        if not any(d.id == "renewal-2027" for d in customer.deals):
            customer.deals.append(Deal(id="renewal-2027", name="Renewal 2027", status="Open"))
        customer.activity.insert(
            0,
            Activity(
                at=_stamp(self.now),
                text=f"Renewal 2027 deal opened on {customer.name}. No new customer created.",
            ),
        )
        return True

    def generate_contract(self) -> AppState:
        acc = self._active()
        customer = acc.customer
        selected = _lock_quoted_offer(acc)
        if not acc.contract_generated:
            acc.contract_generated = True
            customer.activity.insert(
                0,
                Activity(
                    at=_stamp(self.now),
                    text=(
                        f"{customer.contract.name} generated from quoted "
                        f"{selected.name} plan at {customer.contract.quote_amount}."
                    ),
                ),
            )
        return self.snapshot()

    def negotiate_contract(
        self,
        package_id: str,
        concern: str,
        concession_percent: int,
        action: str,
    ) -> AppState:
        del package_id, concern, concession_percent, action
        _lock_quoted_offer(self._active())
        return self.snapshot()

    def send_for_signature(self) -> AppState:
        acc = self._active()
        customer = acc.customer
        if acc.contract_generated and acc.sign_index == 0:
            acc.sign_index = 1
            acc.sent_at = self.now
            acc.reminder_sent_at = None
            acc.reminder_count = 0
            customer.activity.insert(
                0,
                Activity(
                    at=_stamp(self.now),
                    text=f"{customer.contract.name} sent for signature to {_signer(customer).name}.",
                ),
            )
        return self.snapshot()

    def advance_signing(self) -> AppState:
        acc = self._active()
        customer = acc.customer
        notes = {
            2: f"Customer signed {customer.contract.name}.",
            3: "Experience.com countersigned.",
            4: (
                f"{customer.contract.name} fully executed. Signed Contract stored on "
                f"{customer.name}. Initial Purchase → Won."
            ),
        }
        if acc.contract_generated and acc.sign_index < 4:
            acc.sign_index += 1
            text = notes.get(acc.sign_index)
            if text:
                customer.activity.insert(0, Activity(at=_stamp(self.now), text=text))
            if acc.sign_index >= 4:
                path = write_executed_pdf(acc, _fmt(self.now))
                customer.activity.insert(
                    0,
                    Activity(
                        at=_stamp(self.now),
                        text=f"Executed PDF stored: {path.name}. Available to download on Documents.",
                    ),
                )
        return self.snapshot()

    def executed_pdf(self, customer_id: str):
        if customer_id not in self.accounts:
            return None
        acc = self.accounts[customer_id]
        if acc.sign_index < 4:
            return None
        path = executed_pdf_path(customer_id)
        if not path.exists():
            path = write_executed_pdf(acc, _fmt(self.now))
        return path

    def start_renewal(self) -> AppState:
        acc = self._active()
        if acc.days_until_expiry > 30:
            self.now = RENEWAL_WINDOW
            _refresh(acc, self.now)
        self._open_renewal_deal(acc)
        return self.snapshot()

    def run_renewal_copilot(self, customer_id: str, action: str) -> AppState:
        if customer_id not in self.accounts:
            return self.snapshot()
        self.active_id = customer_id
        acc = self.accounts[customer_id]
        _refresh(acc, self.now)
        customer = acc.customer
        signer = _signer(customer)
        band = _nudge_band(acc.days_until_expiry) or "30"
        steps: list[str] = []
        opened = False
        quote_draft = acc.quote_draft or _uplift(customer.contract.quote_amount)

        steps.append(f"Scanned portfolio. Focused {customer.name} ({customer.source_crm}).")
        steps.append(
            f"Term { _fmt(customer.contract.term_start) } → { _fmt(customer.contract.term_end) }. "
            f"{acc.days_until_expiry} days left. Cadence: {_band_label(band) or 'outside notice window'}."
        )
        steps.append(f"Signer {signer.name}" + (f" · {signer.email}" if signer.email else "") + ".")

        if acc.days_until_expiry > 30 and action != "snooze":
            steps.append("Outside the 30-day window. Jump the demo clock to 11 months later, then run again.")
            self.last_renewal = RenewalRun(
                customer_id=customer.id,
                company=customer.name,
                action=action,
                steps=steps,
            )
            return self.snapshot()

        if action == "snooze":
            acc.snoozed = True
            acc.last_nudge_band = band
            nxt = _band_label(NEXT_BAND.get(band)) or "term end"
            customer.activity.insert(
                0,
                Activity(
                    at=_stamp(self.now),
                    text=f"Renewal copilot snoozed {customer.name}. Next nudge: {nxt}.",
                ),
            )
            steps.append(f"Snoozed. Will re-nudge at {nxt} with a different message.")
            self.last_renewal = RenewalRun(
                customer_id=customer.id,
                company=customer.name,
                action="snooze",
                nudge_band=band,
                steps=steps,
            )
            return self.snapshot()

        if action == "nudge":
            if not acc.snoozed:
                steps.append("Nothing to nudge — this account is not snoozed. Run the copilot or snooze first.")
            elif acc.last_nudge_band == band:
                steps.append(
                    f"Already nudged at the {_band_label(band)}. Advance the cadence clock to "
                    f"{_band_label(NEXT_BAND.get(band)) or 'term end'}."
                )
            else:
                quote_draft = _uplift(customer.contract.quote_amount)
                subject, body = _email_for(acc, band, quote_draft)
                acc.quote_draft = quote_draft
                acc.email_subject = subject
                acc.email_body = body
                acc.last_nudge_band = band
                acc.snoozed = True
                customer.activity.insert(
                    0,
                    Activity(
                        at=_stamp(self.now),
                        text=f"Renewal copilot sent {_band_label(band)} to {signer.name}. Quote {quote_draft}.",
                    ),
                )
                steps.append(f"Re-nudged at {_band_label(band)}. New email drafted to {signer.name}.")
                steps.append(f"Renewal 2027 still not opened — waiting for a Run copilot.")
                self.last_renewal = RenewalRun(
                    customer_id=customer.id,
                    company=customer.name,
                    action="nudge",
                    nudge_band=band,
                    quote_draft=quote_draft,
                    email_subject=subject,
                    email_body=body,
                    steps=steps,
                )
                return self.snapshot()
            self.last_renewal = RenewalRun(
                customer_id=customer.id,
                company=customer.name,
                action="nudge",
                nudge_band=band,
                steps=steps,
            )
            return self.snapshot()

        if acc.sign_index < 4:
            steps.append("Initial purchase is not Fully Executed. Flagged — still opening Renewal 2027 on this record.")

        quote_draft = _uplift(customer.contract.quote_amount)
        subject, body = _email_for(acc, band, quote_draft)
        acc.quote_draft = quote_draft
        acc.email_subject = subject
        acc.email_body = body
        acc.last_nudge_band = band
        opened = self._open_renewal_deal(acc)
        steps.append(f"Drafted Renewal 2027 quote {quote_draft} (5% on current).")
        steps.append(f"Drafted {_band_label(band)} email to {signer.name}.")
        if opened:
            steps.append("Opened Renewal 2027 under Deals on this customer. No duplicate account.")
        else:
            steps.append("Renewal 2027 was already open on this customer.")

        self.last_renewal = RenewalRun(
            customer_id=customer.id,
            company=customer.name,
            action="run",
            nudge_band=band,
            opened_deal=acc.renewal_started,
            quote_draft=quote_draft,
            email_subject=subject,
            email_body=body,
            steps=steps,
        )
        return self.snapshot()

    def enqueue_handoff(self, lead: HandoffLead) -> HandoffLead:
        """Receive a handoff pushed from the Lead & Deal Workspace.

        Upserts on lead id: a re-send replaces the entry instead of adding a second
        one and keeps the customer link, so accepting it again refreshes the same
        Customer 360 (accept_handoff's "no duplicate account" path).
        """
        existing = next((item for item in self.inbox if item.id == lead.id), None)
        if existing is None:
            self.inbox.insert(0, lead)
            return lead
        lead.customer_id = existing.customer_id or lead.customer_id
        self.inbox[self.inbox.index(existing)] = lead
        return lead

    def accept_handoff(self, lead_id: str) -> AppState:
        lead = next((item for item in self.inbox if item.id == lead_id), None)
        if lead is None:
            return self.snapshot()
        if lead.status == "accepted" and lead.customer_id:
            self.active_id = lead.customer_id
            return self.snapshot()

        steps: list[str] = []
        steps.append(f"Read {lead.source_crm} payload for {lead.company}.")

        contacts = [c.model_copy() for c in lead.contacts]
        signer = next((c for c in contacts if c.is_signer), None)
        if signer:
            steps.append(f"Detected signer {signer.name} — {signer.role}.")
        elif contacts:
            contacts[0].is_signer = True
            signer = contacts[0]
            lead.contacts = contacts
            steps.append(f"No signer flagged in CRM. Using {signer.name} as signer.")
        else:
            steps.append("CRM file has no contacts — cannot create a customer yet.")
            return self.snapshot()

        contract_name = AGREEMENT_BY_CRM[lead.source_crm]
        steps.append(f"Mapped {lead.source_crm} → {contract_name}.")

        customer_id = lead.customer_id or _slug(lead.company)
        merged = customer_id in self.accounts
        if merged:
            acc = self.accounts[customer_id]
            acc.customer.contract.quote_amount = lead.quote_amount
            acc.customer.source_crm = lead.source_crm
            acc.customer.contract.name = contract_name
            acc.customer.activity.insert(
                0,
                Activity(
                    at=_stamp(self.now),
                    text=(
                        f"Handoff agent refreshed {lead.company} from {lead.source_crm}. "
                        "Same customer — no duplicate account."
                    ),
                ),
            )
            steps.append(f"{lead.company} already exists. Refreshed quote on the same record.")
        else:
            lead.customer_id = customer_id
            lead.contacts = contacts
            self.accounts[customer_id] = _account_from_lead(lead, self.now)
            steps.append(
                f"Created Customer 360 for {lead.company}. Quote {lead.quote_amount} and contacts attached."
            )

        if lead.gaps:
            steps.append("Flagged gaps: " + "; ".join(lead.gaps) + ".")
            self.accounts[customer_id].customer.activity.insert(
                0,
                Activity(
                    at=_stamp(self.now),
                    text="Gaps from lead team: " + "; ".join(lead.gaps) + ".",
                ),
            )
        else:
            steps.append("No blocking gaps. Ready to generate contract.")

        lead.status = "accepted"
        lead.accepted_at = _stamp(self.now)
        lead.customer_id = customer_id
        self.active_id = customer_id
        self.last_handoff = HandoffRun(
            lead_id=lead.id,
            customer_id=customer_id,
            company=lead.company,
            source_crm=lead.source_crm,
            contract_name=contract_name,
            merged=merged,
            steps=steps,
            gaps=list(lead.gaps),
        )
        return self.snapshot()


store = Store()
