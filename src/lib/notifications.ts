import { cookies } from "next/headers";
import { listRecentInquiries, type InquiryNotification } from "@/lib/repo/notifications";

const SEEN_COOKIE = "se_inquiries_seen";

export interface NotificationState {
  items: InquiryNotification[];
  unread: number;
  seenAt: string | null;
}

export async function getNotificationState(): Promise<NotificationState> {
  const store = await cookies();
  const seenAt = store.get(SEEN_COOKIE)?.value ?? null;
  const items = await listRecentInquiries();
  const cutoff = seenAt ? new Date(seenAt).getTime() : 0;
  const unread = items.filter((i) => new Date(i.created_at).getTime() > cutoff).length;
  return { items, unread, seenAt };
}

export async function markInquiriesSeen() {
  const store = await cookies();
  store.set(SEEN_COOKIE, new Date().toISOString(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
