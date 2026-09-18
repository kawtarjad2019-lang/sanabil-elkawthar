import AppShell, { type Section } from "../components/app-shell";

const validSections = new Set<Section>(["students", "teachers", "classes", "subjects", "payments", "attendance", "expenses", "reports", "settings"]);

export default async function SectionPage({ params }: PageProps<"/[section]">) {
  const { section } = await params;
  return <AppShell page={validSections.has(section as Section) ? (section as Section) : "dashboard"} />;
}
