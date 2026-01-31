"use client";

import { useRouter } from "next/navigation";
import { useUi } from "@/components/UiProvider";

export default function HomePage() {
  const router = useRouter();
  const { t } = useUi();

  return (
    <main className="page landing">
      <section className="landing-content">
        <h1>{t("heroTitle")}</h1>
        <button className="btn btn-primary" onClick={() => router.push("/interview")}>
          {t("startInterview")}
        </button>
      </section>
    </main>
  );
}
