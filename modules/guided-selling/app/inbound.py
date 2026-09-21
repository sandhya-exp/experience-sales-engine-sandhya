"""Inbound handoff from the Lead & Deal Workspace ("Continue to Guided Selling").

Maps the workspace's schema-2.0 quote context (see ../../docs/QUOTE_HANDOFF.md) onto the
existing HandoffLead so it lands in the same inbox as CRM-sourced handoffs and flows through
the unchanged accept_handoff → Customer 360 → Contract → Signing → Renewal path.

Nothing commercial is decided here: no quote amount, package, tier or discount. The
customer's budget is passed as context only.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models import Contact, CrmSource, HandoffLead

NATIVE_SOURCE: CrmSource = "Experience.com"
NOT_YET_QUOTED = "To be quoted"


class InboundHandoff(BaseModel):
    """Only the fields the receiver reads; the rest of the payload is accepted and ignored."""

    schema_version: str = "2.0"
    source: str = "lead-deal-workspace"
    handoff: dict[str, Any] = Field(default_factory=dict)
    opportunity: dict[str, Any]
    customer: dict[str, Any]
    need: dict[str, Any] = Field(default_factory=dict)
    sizing: dict[str, Any] = Field(default_factory=dict)
    qualification: dict[str, Any] = Field(default_factory=dict)
    contacts: list[dict[str, Any]] = Field(default_factory=list)
    insights: list[str] = Field(default_factory=list)


def _contacts_for(rows: list[dict[str, Any]], decision_maker: Optional[str]) -> list[Contact]:
    dm = (decision_maker or "").strip().lower()
    contacts: list[Contact] = []
    for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        contacts.append(
            Contact(
                name=name,
                role=row.get("title") or ("Primary contact" if row.get("is_primary") else "Contact"),
                # The signer is the confirmed decision maker when we can match one;
                # otherwise nobody is flagged and accept_handoff applies its own fallback.
                is_signer=bool(dm) and (name.lower() in dm or dm in name.lower()),
                email=row.get("email") or "",
            )
        )
    return contacts


def _sentence(text: str) -> str:
    return text.strip().rstrip(".") + "."


def lead_from_payload(payload: InboundHandoff) -> HandoffLead:
    opp = payload.opportunity
    customer = payload.customer
    need = payload.need
    sizing = payload.sizing
    qual = payload.qualification

    summary = need.get("summary") or need.get("primary_need") or "Requirement captured in the Lead & Deal Workspace."
    detail = [_sentence(summary)]
    users = sizing.get("users")
    if users and str(users) not in summary:
        detail.append(f"{users} users.")
    locations = sizing.get("locations")
    if locations and str(locations).lower() not in summary.lower():
        detail.append(_sentence(str(locations)))
    integrations = [str(x) for x in (need.get("integrations") or []) if x]
    if integrations:
        detail.append(f"Integrations: {', '.join(integrations)}.")
    if payload.insights and payload.insights[0].rstrip(".") not in summary:
        detail.append(_sentence(payload.insights[0]))
    budget = qual.get("budget") or None
    if budget:
        detail.append(f"Budget context: {budget}.")

    return HandoffLead(
        id=f"se-{opp['id']}",
        source_crm=NATIVE_SOURCE,
        company=customer.get("name") or "Unnamed customer",
        quote_amount=NOT_YET_QUOTED,
        why_qualified=" ".join(detail),
        gaps=[str(g) for g in (qual.get("missing") or [])],
        contacts=_contacts_for(payload.contacts, qual.get("decision_maker")),
        customer_id=customer.get("key") or None,
        budget_context=budget,
    )
