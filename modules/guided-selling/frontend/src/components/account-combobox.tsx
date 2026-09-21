import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '../lib/utils'
import type { AccountSummary } from '../types'

export function AccountCombobox({
  accounts,
  selectedId,
  onSelect,
  light = false,
}: {
  accounts: AccountSummary[]
  selectedId: string
  onSelect: (id: string) => void
  /** Light trigger for use outside the dark sidebar (embedded mode). */
  light?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const selected = accounts.find((a) => a.id === selectedId)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a) => a.name.toLowerCase().includes(q))
  }, [accounts, query])

  useEffect(() => {
    function close(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm',
          light ? 'border-border bg-white text-foreground hover:bg-muted' : 'border-white/20 bg-white/10 hover:bg-white/15',
        )}
        onClick={() => {
          setOpen((v) => !v)
          setQuery('')
        }}
      >
        <span className="min-w-0">
          <strong className="block truncate">{selected?.name ?? 'Select account'}</strong>
          <span className={cn('block truncate text-xs', light ? 'text-muted-foreground' : 'text-white/60')}>
            {accounts.length} accounts
          </span>
        </span>
        <ChevronsUpDown className={cn('h-4 w-4 shrink-0', light ? 'text-muted-foreground' : 'text-white/70')} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border bg-white text-foreground shadow-voce">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search accounts…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">No account matches “{query}”.</li>
            )}
            {matches.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted',
                    account.id === selectedId && 'bg-primary/5',
                  )}
                  onClick={() => {
                    onSelect(account.id)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  <Check className={cn('mt-0.5 h-4 w-4 shrink-0', account.id === selectedId ? 'text-primary' : 'text-transparent')} />
                  <span className="min-w-0">
                    <strong className="block truncate">{account.name}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
