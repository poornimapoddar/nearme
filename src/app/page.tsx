import NearbySearchSection from "@/components/sections/NearbySearchSection";

export default function HomePage() {
  return (
    <main className="page-root">
      <header className="page-header">
        <h1>Near Me</h1>
        <p>Search a place like &quot;salon&quot; and discover nearby results on the map.</p>
      </header>
      <NearbySearchSection />
    </main>
  );
}
