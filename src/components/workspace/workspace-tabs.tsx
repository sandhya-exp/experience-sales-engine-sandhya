"use client";

import { useRouter, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function WorkspaceTabs({
  defaultTab,
  overview,
  contacts,
  activity,
  qualification,
  brief,
}: {
  defaultTab: string;
  overview: React.ReactNode;
  contacts: React.ReactNode;
  activity: React.ReactNode;
  qualification: React.ReactNode;
  brief: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs
      // Controlled by the URL so in-app links like "Complete Qualification →"
      // (?tab=qualification&focus=budget) switch tabs without a full reload.
      value={defaultTab}
      onValueChange={(value) => router.replace(`${pathname}?tab=${value}`, { scroll: false })}
    >
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="qualification">Qualification</TabsTrigger>
        <TabsTrigger value="brief">AI Intelligence</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">{overview}</TabsContent>
      <TabsContent value="contacts">{contacts}</TabsContent>
      <TabsContent value="activity">{activity}</TabsContent>
      <TabsContent value="qualification">{qualification}</TabsContent>
      <TabsContent value="brief">{brief}</TabsContent>
    </Tabs>
  );
}
