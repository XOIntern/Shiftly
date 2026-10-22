import { Header } from "@/components/home/header";
import { Hero } from "@/components/home/hero";

// Fully static: no request-time read, so the landing prerenders whole.
export default function Home() {
  return (
    <main>
      <div className="bg-(image:--gradient-hero) dark:bg-none">
        <Header />
        <Hero />
      </div>
    </main>
  );
}
