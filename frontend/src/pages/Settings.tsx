import ThemeToggle from "../components/ThemeToggleButton";

export default function Settings() {
  return (
    <div className="min-h-screen bg-app p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Settings</h1>
      </header>

      <ThemeToggle></ThemeToggle>
    </div>
  );
}
