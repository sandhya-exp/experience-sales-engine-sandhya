const SIGN_STEPS = [
  "Draft",
  "Sent to Customer",
  "Customer Signed",
  "Experience.com Countersigned",
  "Fully Executed",
];

const ui = { view: "handoff", reminderSnoozed: false };
let state = null;

function customer() {
  return state.customer;
}

function signerName() {
  const person = customer().contacts.find((p) => p.is_signer);
  return person ? person.name : customer().contacts[0].name;
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed`);
  return res.json();
}

function fmtClock(iso) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTerm(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dealClass(status) {
  if (status === "Won") return "status-won";
  if (status === "Active") return "status-active";
  return "status-open";
}

function treeHtml() {
  const c = customer();
  const contract = c.contract;
  const won = state.sign_index >= 4;
  const renewal = c.deals.find((d) => d.id === "renewal-2027");
  const initial = c.deals.find((d) => d.id === "initial");
  return `
    <div class="tree">
      <div class="node"><strong>${c.name}</strong></div>
      <div class="branch">
        <div class="leaf">Contacts</div>
        <div class="branch">
          ${c.contacts
            .map(
              (p) =>
                `<div>${p.name} — ${p.role}${p.is_signer ? ' <span class="muted">signer</span>' : ""}</div>`
            )
            .join("")}
        </div>
        <div class="leaf">Deals</div>
        <div class="branch">
          <div>${initial.name} — <span class="${dealClass(initial.status)}">${initial.status}</span></div>
          ${
            renewal
              ? `<div>${renewal.name} — <span class="status-open">${renewal.status}</span></div>`
              : `<div class="muted">No duplicate “${c.name} Renewal” account. Renewal will attach here.</div>`
          }
        </div>
        <div class="leaf">Contracts</div>
        <div class="branch">
          <div>2026–27 — <span class="${won ? "status-active" : ""}">${
            state.contract_generated ? contract.status : "Not generated"
          }</span></div>
        </div>
        <div class="leaf">Documents</div>
        <div class="branch">
          <div>${c.documents.map((d) => d.name).join(", ")}</div>
        </div>
        <div class="leaf">Activity</div>
        <div class="branch"><div class="muted">${c.activity[0].text}</div></div>
      </div>
    </div>
  `;
}

function viewHandoff() {
  const inbox = state.inbox || [];
  const queued = inbox.filter((l) => l.status === "queued");
  const accepted = inbox.filter((l) => l.status === "accepted");
  const run = state.last_handoff;

  const leadCard = (lead) => {
    const signer = lead.contacts.find((p) => p.is_signer) || lead.contacts[0];
    const agreement = {
      Encompass: "Encompass Agreement",
      "Total Expert": "Experience.com Agreement",
      BytePro: "Experience.com Agreement",
      AgencyZoom: "Experience.com Agreement",
    }[lead.source_crm];
    return `
      <article class="lead-card ${lead.status}">
        <div class="lead-top">
          <div>
            <strong>${lead.company}</strong>
            <div class="muted">${lead.source_crm} · Quote ${lead.quote_amount}</div>
          </div>
          <span class="badge ${lead.status === "queued" ? "due" : "executed"}">${lead.status}</span>
        </div>
        <p>${lead.why_qualified}</p>
        <div class="muted">Signer ${signer ? signer.name : "—"} · Maps to ${agreement}</div>
        ${
          lead.gaps.length
            ? `<div class="gaps">${lead.gaps.map((g) => `<span class="gap">${g}</span>`).join("")}</div>`
            : ""
        }
        <div class="actions">
          ${
            lead.status === "queued"
              ? `<button class="primary accept-lead" data-lead="${lead.id}">Accept handoff</button>`
              : `<button class="secondary open-lead" data-account="${lead.customer_id}">Open Customer 360</button>`
          }
        </div>
      </article>
    `;
  };

  return `
    <div class="grid handoff-grid">
      <div>
        <section class="card">
          <div class="label">Inbound queue</div>
          <h2>${queued.length} qualified deal${queued.length === 1 ? "" : "s"} waiting</h2>
          <p style="color:var(--muted);margin:10px 0 0;line-height:1.6;">
            Lead team owns inquiry. This agent reads the CRM payload, picks the agreement type, and creates or refreshes one customer record.
          </p>
        </section>
        <div class="lead-list">${queued.map(leadCard).join("") || `<p class="muted">Queue is clear.</p>`}</div>
        <section class="card" style="margin-top:16px;">
          <div class="label">Already in workspace</div>
          <div class="lead-list compact">${accepted.map(leadCard).join("")}</div>
        </section>
      </div>
      <section class="card">
        <div class="label">Handoff agent</div>
        <h2>${run ? run.company : "Waiting for a payload"}</h2>
        ${
          run
            ? `<p style="color:var(--muted);margin:10px 0 16px;line-height:1.6;">
                ${run.source_crm} → ${run.contract_name}${run.merged ? " · merged onto existing account" : " · new Customer 360"}.
              </p>
              <ol class="agent-steps">${run.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
              ${
                run.gaps.length
                  ? `<div class="notice">Still missing: ${run.gaps.join("; ")}. Contract can still be generated — flag on the account.</div>`
                  : `<div class="notice">Ready for Generate Contract on ${run.company}.</div>`
              }
              <div class="actions">
                <button class="primary" id="openAfterHandoff" data-account="${run.customer_id}">Open ${run.company}</button>
              </div>`
            : `<p style="color:var(--muted);margin:10px 0 0;line-height:1.6;">
                Accept a queued deal. The agent will parse contacts, detect the signer, map Encompass → Encompass Agreement (everything else → Experience.com Agreement), create Customer 360, and write the gaps into Activity.
              </p>`
        }
      </section>
    </div>
  `;
}

function viewCustomer() {
  const c = customer();
  return `
    <div class="grid">
      <section class="card">
        <div class="label">Account structure</div>
        <h2>One customer, many deals</h2>
        <p class="clock-hint" style="color:var(--muted);margin:10px 0 16px;">
          Renewals never create ${c.name} / ${c.name} Renewal / ${c.name} 2027.
        </p>
        ${treeHtml()}
      </section>
      <section class="card">
        <div class="label">Activity</div>
        <h2>What happened on this account</h2>
        <div class="timeline" style="margin-top:16px;">
          ${c.activity
            .map((e) => `<div class="event"><time>${e.at}</time><div>${e.text}</div></div>`)
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function viewContract() {
  const c = customer();
  const contract = c.contract;
  const status = state.contract_generated ? contract.status : "Draft (not generated)";
  return `
    <div class="contract-hero">
      <div class="stat"><div class="k">Customer</div><div class="v">${c.name}</div></div>
      <div class="stat"><div class="k">Quote</div><div class="v">${contract.quote_amount}</div></div>
      <div class="stat"><div class="k">Contract</div><div class="v">${contract.name}</div></div>
      <div class="stat"><div class="k">Status</div><div class="v">${status}</div></div>
    </div>
    <section class="card">
      <div class="paper">
        <h3>${contract.name}</h3>
        <div class="meta">Term ${fmtTerm(contract.term_start)} → ${fmtTerm(contract.term_end)} · Annual subscription ${contract.quote_amount} · Source ${c.source_crm}</div>
        ${
          state.contract_generated
            ? `<p>This Agreement is entered into by Experience.com (“Provider”) and ${c.name} (“Customer”) for the licensed use of the Experience.com platform, including reputation, surveys, and workflow modules quoted on Quote v2. Originating CRM: ${c.source_crm}.</p>
               <p>Customer shall pay the annual fee in advance. The initial term is twelve (12) months and renews unless notice is given thirty (30) days prior to expiry. Documents of record: Quote v2, Order Form, and this Agreement.</p>`
            : `<p>No contract file yet. Generate a draft from the accepted quote. The customer record stays ${c.name} — this is paperwork on the qualified ${c.source_crm} deal, not a new account.</p>`
        }
      </div>
      <div class="actions">
        <button class="primary" id="genContract" ${state.contract_generated ? "disabled" : ""}>Generate Contract</button>
        <button class="secondary" id="sendSign" ${!state.contract_generated || state.sign_index > 0 ? "disabled" : ""}>Send for Signature</button>
      </div>
    </section>
  `;
}

function viewSigning() {
  const c = customer();
  const idx = state.sign_index;
  const steps = SIGN_STEPS.map((name, i) => {
    const cls = i < idx ? "done" : i === idx ? "current" : "";
    const sub = [
      `Internal draft of ${c.contract.name}`,
      `Envelope sent to ${signerName()}`,
      "Customer executed",
      "Countersign by Experience.com",
      "Stored on the customer record",
    ][i];
    return `
      <div class="step ${cls}">
        <div class="dot"></div>
        <div>
          <div class="step-title">${name}</div>
          <div class="step-sub">${sub}</div>
        </div>
      </div>
      ${i < SIGN_STEPS.length - 1 ? `<div class="connector"></div>` : ""}
    `;
  }).join("");

  let cta = "";
  if (!state.contract_generated) {
    cta = `<p class="notice">Generate the contract first, then send for signature.</p>`;
  } else if (idx === 0) {
    cta = `<button class="primary" id="advanceSign">Send to Customer</button>`;
  } else if (idx === 1) {
    cta = `<button class="primary" id="advanceSign">Record customer signature</button>`;
  } else if (idx === 2) {
    cta = `<button class="primary" id="advanceSign">Countersign for Experience.com</button>`;
  } else if (idx === 3) {
    cta = `<button class="primary" id="advanceSign">Mark fully executed</button>`;
  } else {
    cta = `<div class="notice">Fully executed. Signed Contract is stored under ${c.name} → Documents. Initial Purchase is Won.</div>`;
  }

  return `
    <section class="card">
      <div class="label">Signature envelope</div>
      <h2>${c.contract.name} · ${c.name}</h2>
      <div class="flow" style="margin-top:18px;">${steps}</div>
      <div class="actions">${cta}</div>
    </section>
  `;
}

function badgeClass(status) {
  const s = status.toLowerCase();
  if (s.includes("execut") || s.includes("accepted")) return "executed";
  if (s.includes("signed") || s.includes("countersign")) return "signed";
  if (s.includes("sent")) return "sent";
  if (s.includes("supersed") || s.includes("not created") || s.includes("pending")) return "superseded";
  if (s.includes("draft") || s.includes("attached")) return "draft";
  if (s.includes("due")) return "due";
  return "draft";
}

function viewDocuments() {
  const c = customer();
  const rows = c.documents
    .map(
      (d) => `
      <tr>
        <td><div class="file">📄 ${d.name}</div></td>
        <td>${d.type}</td>
        <td>${d.version}</td>
        <td>${d.created}</td>
        <td><span class="badge ${badgeClass(d.status)}">${d.status}</span></td>
        <td>${d.signed}</td>
        <td>${d.expiry}</td>
      </tr>`
    )
    .join("");
  return `
    <section class="card">
      <div class="label">Inside the customer</div>
      <h2>Documents · ${c.name}</h2>
      <table style="margin-top:12px;">
        <thead>
          <tr>
            <th>Document</th><th>Type</th><th>Version</th>
            <th>Created</th><th>Status</th><th>Signed</th><th>Expiry</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function viewRenewal() {
  const watch = state.watchlist || [];
  const due = watch.filter((w) => w.status === "due" || w.status === "snoozed");
  const run = state.last_renewal;
  const statusBadge = {
    watching: "draft",
    due: "due",
    snoozed: "sent",
    open: "executed",
    expired: "superseded",
  };

  const card = (w) => `
    <article class="lead-card ${w.status}">
      <div class="lead-top">
        <div>
          <strong>${w.name}</strong>
          <div class="muted">${w.source_crm} · ${w.contract_name} · ${w.quote_amount}</div>
        </div>
        <span class="badge ${statusBadge[w.status] || "draft"}">${w.status}${w.days_until_expiry > 0 ? ` · ${w.days_until_expiry}d` : ""}</span>
      </div>
      <p>Signer ${w.signer}${w.signer_email ? ` · ${w.signer_email}` : ""}. Term ends ${fmtTerm(w.term_end)}.</p>
      <div class="muted">${w.next_nudge ? `Next: ${w.next_nudge}. ` : ""}${w.last_activity}</div>
      <div class="actions">
        <button class="primary run-copilot" data-account="${w.customer_id}" ${w.status === "watching" || w.status === "expired" ? "disabled" : ""}>Run copilot</button>
        <button class="secondary snooze-copilot" data-account="${w.customer_id}" ${w.status === "due" ? "" : "disabled"}>Snooze</button>
        <button class="secondary nudge-copilot" data-account="${w.customer_id}" ${w.status === "snoozed" ? "" : "disabled"}>Send nudge</button>
      </div>
    </article>
  `;

  return `
    <div class="grid handoff-grid">
      <div>
        <section class="card">
          <div class="label">Portfolio watch</div>
          <h2>${due.length ? `${due.length} account${due.length === 1 ? "" : "s"} in the notice window` : "No accounts in the 30-day window"}</h2>
          <p style="color:var(--muted);margin:10px 0 12px;line-height:1.6;">
            Copilot watches every customer — not just the one on screen. Same-record rule: Renewal 2027 attaches under Deals.
          </p>
          <div class="cadence">
            <span class="muted">Cadence clock</span>
            <button class="secondary cadence-btn" data-preset="renewal_window">30 days</button>
            <button class="secondary cadence-btn" data-preset="day_21">21</button>
            <button class="secondary cadence-btn" data-preset="day_14">14</button>
            <button class="secondary cadence-btn" data-preset="day_7">7</button>
          </div>
        </section>
        <div class="lead-list">${watch.map(card).join("")}</div>
      </div>
      <section class="card">
        <div class="label">Renewal copilot</div>
        <h2>${run ? run.company : "Waiting to run"}</h2>
        ${
          run
            ? `<p style="color:var(--muted);margin:10px 0 16px;line-height:1.6;">
                ${run.action}${run.nudge_band ? ` · ${_bandUi(run.nudge_band)}` : ""}${run.opened_deal ? " · Renewal 2027 open" : ""}.
              </p>
              <ol class="agent-steps">${run.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
              ${
                run.quote_draft
                  ? `<div class="draft-block">
                      <div class="label">Draft quote</div>
                      <strong>${run.quote_draft}</strong>
                    </div>`
                  : ""
              }
              ${
                run.email_body
                  ? `<div class="draft-block">
                      <div class="label">Draft email</div>
                      <strong>${run.email_subject}</strong>
                      <pre>${run.email_body}</pre>
                    </div>`
                  : ""
              }
              <div class="actions">
                <button class="primary" id="openAfterRenewal" data-account="${run.customer_id}">Open ${run.company}</button>
              </div>`
            : `<p style="color:var(--muted);margin:10px 0 0;line-height:1.6;">
                Jump 11 months later (or use cadence 30/21/14/7). Then Run copilot on an account: it drafts a 5% renewal quote, writes the signer email, and opens Renewal 2027 on that same customer. Snooze to retry at the next cadence with a different message.
              </p>`
        }
      </section>
    </div>
  `;
}

function _bandUi(band) {
  return { "30": "30-day notice", "21": "21-day follow-up", "14": "14-day warning", "7": "7-day final notice" }[band] || band;
}

function pageTitle() {
  if (ui.view === "customer") return customer().name;
  return {
    handoff: "Lead handoff",
    contract: "Contract",
    signing: "Document signing",
    documents: "Documents",
    renewal: "Renewal copilot",
  }[ui.view];
}

function renderAccounts() {
  const list = document.getElementById("accountList");
  list.innerHTML = (state.customers || [])
    .map(
      (a) => `
      <button class="account-btn ${a.id === customer().id ? "is-active" : ""}" data-account="${a.id}">
        <span class="who">${a.name}</span>
        <span class="src">${a.source_crm} · ${a.contract_name}</span>
      </button>`
    )
    .join("");
  list.querySelectorAll(".account-btn").forEach((btn) => {
    btn.onclick = () => {
      ui.reminderSnoozed = false;
      post("/api/account/select", { body: { customer_id: btn.dataset.account }, view: "customer" });
    };
  });
}

function renderBanner() {
  const el = document.getElementById("renewalBanner");
  const watch = state.watchlist || [];
  const due = watch.filter((w) => w.status === "due" || w.status === "snoozed");
  const open = watch.filter((w) => w.status === "open");
  if (due.length) {
    el.classList.remove("hidden");
    el.innerHTML = `
      <div>
        <strong>Renewal copilot</strong>
        <p>${due.length} account${due.length === 1 ? "" : "s"} in the 30-day window — ${due.map((w) => w.name).join(", ")}.</p>
      </div>
      <button class="warn" id="bannerRenew">Open copilot</button>
    `;
    el.querySelector("#bannerRenew").onclick = () => {
      ui.view = "renewal";
      setNav();
      render();
    };
  } else if (open.length) {
    el.classList.remove("hidden");
    el.innerHTML = `
      <div>
        <strong>Renewal 2027 is open</strong>
        <p>${open.map((w) => w.name).join(", ")} — deal sits under Deals, not a second account.</p>
      </div>
    `;
  } else {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

function closeReminder() {
  const modal = document.getElementById("renewalModal");
  modal.classList.add("hidden");
  document.getElementById("renewalModalCard").innerHTML = "";
}

function renderReminder() {
  const modal = document.getElementById("renewalModal");
  const due = (state.watchlist || []).filter((w) => w.status === "due");
  if (!due.length) {
    ui.reminderSnoozed = false;
    closeReminder();
    return;
  }
  if (ui.reminderSnoozed) {
    closeReminder();
    return;
  }

  const first = due[0];
  document.getElementById("renewalModalCard").innerHTML = `
    <div class="label">Renewal copilot</div>
    <h2 id="renewalModalTitle">${due.length} agreement${due.length === 1 ? "" : "s"} expiring</h2>
    <div class="countdown">${first.days_until_expiry} days left</div>
    <p class="detail">
      Watching the whole book, not just the open account. ${due.map((w) => `${w.name} (${w.days_until_expiry}d)`).join(" · ")}.
    </p>
    <div class="actions">
      <button class="warn" id="modalRenew">Run copilot on ${first.name}</button>
      <button class="secondary" id="modalOpenWatch">Open watchlist</button>
      <button class="secondary" id="modalSnooze">Remind me later</button>
    </div>
  `;
  modal.classList.remove("hidden");

  document.getElementById("modalRenew").onclick = () =>
    post("/api/renewal/copilot", {
      body: { customer_id: first.customer_id, action: "run" },
      view: "renewal",
    });
  document.getElementById("modalOpenWatch").onclick = () => {
    ui.reminderSnoozed = true;
    closeReminder();
    ui.view = "renewal";
    setNav();
    render();
  };
  document.getElementById("modalSnooze").onclick = () => {
    ui.reminderSnoozed = true;
    closeReminder();
  };
  modal.querySelector("[data-dismiss]").onclick = () => {
    ui.reminderSnoozed = true;
    closeReminder();
  };
}

function render() {
  document.getElementById("clockDate").textContent = fmtClock(state.now);
  document.getElementById("pageTitle").textContent = pageTitle();
  const queued = (state.inbox || []).filter((l) => l.status === "queued").length;
  document.getElementById("sourcePill").textContent =
    ui.view === "handoff" ? `Inbox · ${queued} queued` : `Qualified · ${customer().source_crm}`;
  document.getElementById("quotePill").textContent =
    ui.view === "handoff" ? "CRM → Customer 360" : `Quote ${customer().contract.quote_amount}`;
  renderAccounts();
  renderBanner();
  renderReminder();
  const views = {
    handoff: viewHandoff,
    customer: viewCustomer,
    contract: viewContract,
    signing: viewSigning,
    documents: viewDocuments,
    renewal: viewRenewal,
  };
  document.getElementById("viewRoot").innerHTML = views[ui.view]();
  bindView();
}

async function post(path, opts = {}) {
  state = await api(path, "POST", opts.body);
  if (opts.view) ui.view = opts.view;
  setNav();
  render();
}

function bindView() {
  const gen = document.getElementById("genContract");
  if (gen) gen.onclick = () => post("/api/contract/generate");
  const send = document.getElementById("sendSign");
  if (send) send.onclick = () => post("/api/contract/send", { view: "signing" });
  const adv = document.getElementById("advanceSign");
  if (adv) adv.onclick = () => post("/api/signing/advance");
  const renew = document.getElementById("startRenewalBtn");
  if (renew) renew.onclick = () => post("/api/renewal/start", { view: "renewal" });
  document.querySelectorAll(".accept-lead").forEach((btn) => {
    btn.onclick = () => post("/api/handoff/accept", { body: { lead_id: btn.dataset.lead } });
  });
  document.querySelectorAll(".open-lead, #openAfterHandoff, #openAfterRenewal").forEach((btn) => {
    btn.onclick = () =>
      post("/api/account/select", { body: { customer_id: btn.dataset.account }, view: "customer" });
  });
  document.querySelectorAll(".run-copilot").forEach((btn) => {
    btn.onclick = () =>
      post("/api/renewal/copilot", { body: { customer_id: btn.dataset.account, action: "run" }, view: "renewal" });
  });
  document.querySelectorAll(".snooze-copilot").forEach((btn) => {
    btn.onclick = () =>
      post("/api/renewal/copilot", { body: { customer_id: btn.dataset.account, action: "snooze" }, view: "renewal" });
  });
  document.querySelectorAll(".nudge-copilot").forEach((btn) => {
    btn.onclick = () =>
      post("/api/renewal/copilot", { body: { customer_id: btn.dataset.account, action: "nudge" }, view: "renewal" });
  });
  document.querySelectorAll(".cadence-btn").forEach((btn) => {
    btn.onclick = () => post("/api/clock", { body: { preset: btn.dataset.preset }, view: "renewal" });
  });
}

function setNav() {
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === ui.view);
  });
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.onclick = () => {
    ui.view = btn.dataset.view;
    setNav();
    render();
  };
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("renewalModal").classList.contains("hidden")) {
    ui.reminderSnoozed = true;
    closeReminder();
  }
});

document.getElementById("clockNow").onclick = () => post("/api/clock", { body: { preset: "start" } });
document.getElementById("clockRenewal").onclick = () =>
  post("/api/clock", { body: { preset: "renewal_window" }, view: "renewal" });

api("/api/state").then((data) => {
  state = data;
  render();
});
