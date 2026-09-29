import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EditContactDialog } from "@/components/workspace/edit-contact-dialog";
import { AddContactMenu } from "@/components/contacts/add-contact-menu";
import { contactSourceLabel } from "@/lib/contacts/source";
import type { Contact, Lead } from "@/lib/types";
import type { TeamMember } from "@/lib/repo/users";

/**
 * Where a contact came from. Rows written before provenance existed carry no
 * `source`; for those, a contact created in the same moment as an inquiry is
 * that inquiry's contact, and anything else was typed in by hand.
 */
function provenance(c: Contact, lead: Pick<Lead, "created_at">): string {
  const label = contactSourceLabel(c.source);
  if (label) return label;
  const dt = Math.abs(new Date(c.created_at).getTime() - new Date(lead.created_at).getTime());
  return dt < 15_000 ? "Created from inquiry" : "Added manually";
}

export function ContactsTab({ leadId, companyId, companyName, contacts, lead, team }: { leadId: string; companyId: string; companyName: string; contacts: Contact[]; lead: Lead; team: TeamMember[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Contacts</CardTitle>
        <AddContactMenu companyId={companyId} companyName={companyName} leadId={leadId} team={team.map((m) => ({ id: m.id, name: m.name }))} defaultOwnerId={lead.owner_user_id} />
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Primary</TableHead>
              <TableHead className="w-16 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.title ?? "—"}</TableCell>
                <TableCell>
                  <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                    {c.email}
                  </a>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:text-foreground">
                      {c.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">{provenance(c, lead)}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{c.is_primary ? "Primary" : ""}</TableCell>
                <TableCell className="py-1 text-right">
                  <EditContactDialog leadId={leadId} contact={c} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
