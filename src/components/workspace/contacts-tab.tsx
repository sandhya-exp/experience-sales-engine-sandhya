import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddContactDialog } from "@/components/workspace/add-contact-dialog";
import type { Contact } from "@/lib/types";

export function ContactsTab({ leadId, companyId, contacts }: { leadId: string; companyId: string; contacts: Contact[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Contacts</CardTitle>
        <AddContactDialog leadId={leadId} companyId={companyId} />
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Primary</TableHead>
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
                <TableCell className="text-[13px] text-muted-foreground">{c.is_primary ? "Primary" : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
