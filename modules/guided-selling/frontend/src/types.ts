export type View = 'home' | 'handoff' | 'customer' | 'contract' | 'signing' | 'documents' | 'renewal'

export interface Contact {
  name: string
  role: string
  is_signer: boolean
  email: string
}

export interface Deal {
  id: string
  name: string
  status: string
}

export interface Contract {
  name: string
  status: string
  generated: boolean
  term_start: string
  term_end: string
  quote_amount: string
}

export interface Document {
  name: string
  type: string
  version: string
  created: string
  status: string
  signed: string
  expiry: string
  filename?: string
  download_url?: string
}

export interface Customer {
  id: string
  name: string
  source_crm: string
  contacts: Contact[]
  deals: Deal[]
  contract: Contract
  documents: Document[]
  activity: Array<{ at: string; text: string }>
}

export interface AccountSummary {
  id: string
  name: string
  source_crm: string
  contract_name: string
}

export interface HandoffLead {
  id: string
  source_crm: string
  company: string
  quote_amount: string
  quote_version: string
  status: 'queued' | 'accepted'
  why_qualified: string
  gaps: string[]
  contacts: Contact[]
  customer_id?: string
}

export interface AgentRun {
  customer_id: string
  company: string
  steps: string[]
  contract_name?: string
  action?: string
  nudge_band?: string
  opened_deal?: boolean
  quote_draft?: string
  email_subject?: string
  email_body?: string
  gaps?: string[]
}

export interface RenewalWatch {
  customer_id: string
  name: string
  source_crm: string
  contract_name: string
  quote_amount: string
  signer: string
  signer_email: string
  term_end: string
  days_until_expiry: number
  status: 'watching' | 'due' | 'snoozed' | 'open' | 'expired'
  next_nudge?: string
  last_activity: string
}

export interface ContractPackage {
  id: string
  name: string
  annual_price: number
  display_price: string
  features: string[]
  best_for: string
  recommended: boolean
}

export interface ContractNegotiation {
  status: 'open' | 'proposed' | 'agreed'
  selected_package_id: string
  selected_package_name: string
  concern: string
  concern_label: string
  concession_percent: number
  list_price: string
  final_price: string
  suggestion: string
  summary: string
}

export interface SigningWatch {
  status: 'not_sent' | 'waiting_customer' | 'customer_signed' | 'countersigned' | 'fully_executed'
  signer: string
  signer_email: string
  sent_at?: string
  days_waiting: number
  reminder_due_at?: string
  reminder_due: boolean
  reminder_sent_at?: string
  reminder_count: number
}

export interface AppState {
  now: string
  sign_index: number
  contract_generated: boolean
  renewal_started: boolean
  customer: Customer
  customers: AccountSummary[]
  days_until_expiry: number
  renewal_due: boolean
  inbox: HandoffLead[]
  last_handoff?: AgentRun
  watchlist: RenewalWatch[]
  last_renewal?: AgentRun
  contract_packages: ContractPackage[]
  negotiation: ContractNegotiation
  signing_watch: SigningWatch
}
