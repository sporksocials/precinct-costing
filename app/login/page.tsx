import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { PrecinctMark, VenueLogo } from "@/components/brand";

const VENUES = ["drift", "chiobu", "greedy", "gelato"];

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-16">
      <div className="w-full max-w-[380px]">
        <h1 className="sr-only">Caloundra Food Precinct costing</h1>
        <div className="flex justify-center">
          <PrecinctMark size="lg" sub="Costing" />
        </div>
        <div className="mt-8 grid grid-cols-4 items-center gap-3 opacity-90">
          {VENUES.map((v) => (
            <div key={v} className="flex h-10 items-center justify-center">
              <VenueLogo slug={v} height={30} className="object-center" />
            </div>
          ))}
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
