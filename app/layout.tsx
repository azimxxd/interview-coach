import "./globals.css";
import type { Metadata } from "next";
import UiControls from "@/components/UiControls";
import { UiProvider } from "@/components/UiProvider";

export const metadata: Metadata = {
  title: "Interview Coach",
  description:
    "Practice interviews with live delivery signals and structured feedback."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <UiProvider>
          <div className="app-shell">
            <UiControls />
            {children}
          </div>
        </UiProvider>
      </body>
    </html>
  );
}
