import { User, LogOut, Settings, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TopNavbarProps {
  studentName: string;
  evaluationStatus: string;
  errorCount: number;
}

export function TopNavbar({ studentName, evaluationStatus, errorCount }: TopNavbarProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white shadow-sm">
      {/* Golden West College gold bar */}
      <div className="h-1.5 bg-gradient-to-r from-gwc-gold to-gwc-gold-dark" />

      <div className="flex h-14 items-center justify-between px-6">
        {/* Left: Logo + Student Name */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-col leading-none">
              <span className="text-xs font-bold text-gwc-green tracking-wide">GOLDEN WEST</span>
              <span className="text-xs font-bold text-gwc-green tracking-wide">COLLEGE</span>
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Student:</span>
            <span className="text-sm font-semibold">{studentName}</span>
          </div>
        </div>

        {/* Center: Dashboard title */}
        <h1 className="text-lg font-bold tracking-tight hidden md:block">DASHBOARD</h1>

        {/* Right: Error Count, Profile, Status */}
        <div className="flex items-center gap-3">
          {/* Current Evaluation Status */}
          <Badge
            variant={evaluationStatus === "in-progress" ? "warning" : "success"}
            className="hidden sm:inline-flex"
          >
            {evaluationStatus === "in-progress" ? "In Progress" : "Completed"}
          </Badge>

          {/* Error Notification Count */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 border border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-xs font-semibold text-red-700">
                  Errors: {errorCount}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Error Notification Count</TooltipContent>
          </Tooltip>

          {/* User Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="User profile">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Evaluator</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
