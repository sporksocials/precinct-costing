import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-16">
      <div className="w-full max-w-[360px]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] bg-[#1c1c1e] text-[34px] font-bold text-white dark:bg-white dark:text-black">P</div>
        <h1 className="mt-5 text-center text-[28px] font-bold tracking-tight">Precinct Costing</h1>
        <p className="mt-1 text-balance text-center text-[15px] text-label-2">Drift Bar · Chiobu · Greedy Gringo’s · Gelato Rumba</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
