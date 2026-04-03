import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Index from "./pages/Index";
import CementingHub from "./pages/CementingHub";
import AnalysisPage from "./pages/AnalysisPage";
import ComingSoon from "./pages/ComingSoon";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import AdminLogin from "./pages/AdminLogin";
import AdminPanel from "./pages/AdminPanel";
import CalcDetail from "./pages/CalcDetail";
import CementPlug from "./pages/CementPlug";
import CoiledTubing from "./pages/CoiledTubing";
import FleetDetail from "./pages/FleetDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cementing" element={<CementingHub />} />
          <Route path="/cementing/program" element={<Index />} />
          <Route path="/cementing/plugs" element={<CementPlug />} />
          <Route path="/cementing/analysis" element={<AnalysisPage />} />
          <Route path="/drilling-fluids" element={<ComingSoon />} />
          <Route path="/fracturing" element={<ComingSoon />} />
          <Route path="/well-design" element={<ComingSoon />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin/calc/:id" element={<CalcDetail />} />
          <Route path="/admin/fleet/:id" element={<FleetDetail />} />
          <Route path="/coiled-tubing" element={<CoiledTubing />} />
          {/* Legacy routes */}
          <Route path="/cement-plug" element={<CementPlug />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
