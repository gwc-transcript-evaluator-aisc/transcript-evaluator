import { useCallback, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNavbar } from "@/components/TopNavbar";
import { Sidebar } from "@/components/Sidebar";
import { Dashboard } from "@/components/Dashboard";
import { ArticulationUploadPage } from "@/pages/ArticulationUploadPage";

const UPLOAD_ROUTE = "#/upload";

function App() {
  const studentName = "Articulation results";
  const evaluationStatus = "completed";
  const errorCount = 0;
  const [route, setRoute] = useState(() => window.location.hash.startsWith(UPLOAD_ROUTE) ? "upload" : "dashboard");

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash.startsWith(UPLOAD_ROUTE) ? "upload" : "dashboard");
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  const openDashboard = useCallback(() => {
    window.location.hash = "#/dashboard";
  }, []);

  const openCompletedRun = useCallback((runId: string, resultKey: string, resultSortKey: string) => {
    const params = new URLSearchParams({ runId, resultKey, resultSortKey });
    window.location.hash = `#/dashboard?${params.toString()}`;
  }, []);

  if (route === "upload") {
    return <ArticulationUploadPage onCancel={openDashboard} onCompleted={openCompletedRun} />;
  }

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
        <TopNavbar studentName={studentName} evaluationStatus={evaluationStatus} errorCount={errorCount} />
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full">
            <Sidebar />
            <Dashboard />
          </div>
          <button type="button" onClick={() => { window.location.hash = UPLOAD_ROUTE; }} className="fixed bottom-6 right-6 rounded-md bg-gwc-green px-4 py-2 text-sm font-semibold text-white shadow hover:bg-gwc-green/90">Upload transcript</button>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
