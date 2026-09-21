from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fpdf import FPDF

if TYPE_CHECKING:
    from app.store import Account

ROOT = Path(__file__).resolve().parent.parent
GENERATED = ROOT / "generated"


def _ascii(value: str) -> str:
    return (
        value.replace("₹", "Rs. ")
        .replace("—", "-")
        .replace("–", "-")
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .encode("latin-1", "replace")
        .decode("latin-1")
    )


class AgreementPDF(FPDF):
    def __init__(self, title: str) -> None:
        super().__init__(format="A4")
        self.agreement_title = _ascii(title)
        self.set_auto_page_break(auto=True, margin=22)

    def header(self) -> None:
        self.set_fill_color(11, 61, 145)
        self.rect(0, 0, 210, 28, "F")
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 16)
        self.set_xy(16, 7)
        self.cell(120, 8, "Experience.com")
        self.set_font("Helvetica", "", 9)
        self.set_xy(16, 16)
        self.cell(120, 6, "Sales Engine  |  Fully Executed Agreement")
        self.set_xy(130, 10)
        self.set_font("Helvetica", "B", 10)
        self.cell(64, 8, "EXECUTED COPY", align="R")
        self.set_text_color(35, 48, 72)
        self.set_y(36)

    def footer(self) -> None:
        self.set_y(-16)
        self.set_draw_color(11, 61, 145)
        self.line(16, self.get_y(), 194, self.get_y())
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(90, 104, 128)
        self.cell(0, 10, f"Confidential  |  Page {self.page_no()} of {{nb}}", align="C")


def write_executed_pdf(account: Account, signed_on: str) -> Path:
    GENERATED.mkdir(parents=True, exist_ok=True)
    customer = account.customer
    signer = next((p for p in customer.contacts if p.is_signer), customer.contacts[0])
    counterpart = "Experience.com Legal"
    filename = f"{customer.id}-executed-agreement.pdf"
    path = GENERATED / filename

    pdf = AgreementPDF(customer.contract.name)
    pdf.alias_nb_pages()
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.multi_cell(0, 8, _ascii(customer.contract.name))
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(51, 81, 127)
    pdf.multi_cell(
        0,
        6,
        _ascii(
            f"This Agreement is entered into by Experience.com and {customer.name}, "
            f"originating from {customer.source_crm}."
        ),
    )
    pdf.ln(6)
    pdf.set_text_color(35, 48, 72)

    rows = [
        ("Customer", customer.name),
        ("Source CRM", customer.source_crm),
        ("Package", account.negotiation_summary.split(" · ")[0] if account.negotiation_summary else "Quoted plan"),
        ("Commercial terms", customer.contract.quote_amount),
        ("Initial term", f"{customer.contract.term_start.strftime('%d %b %Y')} to {customer.contract.term_end.strftime('%d %b %Y')}"),
        ("Customer signer", f"{signer.name} ({signer.role})"),
        ("Signer email", signer.email or "On file"),
        ("Fully executed", signed_on),
    ]
    pdf.set_fill_color(245, 247, 252)
    pdf.set_draw_color(214, 222, 236)
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(48, 8, _ascii(label), border=1, fill=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(130, 8, _ascii(value), border=1, ln=1)

    pdf.ln(8)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, "1. Scope of services", ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        _ascii(
            f"{customer.name} is licensed to use the Experience.com platform for the quoted plan "
            f"during the initial twelve-month term. The commercial amount is "
            f"{customer.contract.quote_amount}. The agreement renews unless either party gives "
            "written notice thirty days before expiry."
        ),
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, "2. Execution", ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        0,
        5.5,
        _ascii(
            "This copy is the fully executed original. It was generated after the customer signed "
            "and Experience.com countersigned. Both signature blocks below are part of the stored record."
        ),
    )
    if account.negotiation_summary:
        pdf.ln(3)
        pdf.set_font("Helvetica", "I", 10)
        pdf.multi_cell(0, 5.5, _ascii(f"Negotiated offer: {account.negotiation_summary}"))

    pdf.ln(10)
    y = pdf.get_y()
    pdf.set_draw_color(11, 61, 145)
    pdf.rect(16, y, 84, 42)
    pdf.rect(110, y, 84, 42)
    pdf.set_xy(20, y + 4)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(76, 5, "CUSTOMER")
    pdf.set_xy(114, y + 4)
    pdf.cell(76, 5, "EXPERIENCE.COM")
    pdf.set_font("Helvetica", "I", 14)
    pdf.set_text_color(11, 61, 145)
    pdf.set_xy(20, y + 14)
    pdf.cell(76, 8, _ascii(signer.name))
    pdf.set_xy(114, y + 14)
    pdf.cell(76, 8, counterpart)
    pdf.set_text_color(35, 48, 72)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(20, y + 26)
    pdf.multi_cell(76, 4, _ascii(f"{signer.role}\nSigned {signed_on}"))
    pdf.set_xy(114, y + 26)
    pdf.multi_cell(76, 4, _ascii(f"Authorized countersignature\nSigned {signed_on}"))

    pdf.output(str(path))
    return path


def executed_pdf_path(customer_id: str) -> Path:
    return GENERATED / f"{customer_id}-executed-agreement.pdf"
