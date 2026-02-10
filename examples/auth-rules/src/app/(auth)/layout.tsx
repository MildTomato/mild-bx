import { LogoShapesWave } from "@/components/logo";
import { ThemePicker } from "@/components/theme-picker";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LogoShapesWave className="fixed top-4 left-4" />
      <div className="fixed top-4 right-4">
        <ThemePicker />
      </div>
      {children}
    </div>
  );
}
