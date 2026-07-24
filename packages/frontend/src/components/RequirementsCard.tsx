import { CheckCircle2, XCircle, Clock, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { RequiredCourse } from "@/types/course";
import { CourseComparison } from "@/types/course";

interface RequirementsCardProps {
  requiredCourses: RequiredCourse[];
  courseComparisons: CourseComparison[];
  currentCourseIndex: number;
  onSelectCourse: (index: number) => void;
}

export function RequirementsCard({
  requiredCourses,
  courseComparisons,
  currentCourseIndex,
  onSelectCourse,
}: RequirementsCardProps) {
  const fulfilled = requiredCourses.filter((c) => c.status === "fulfilled").length;
  const total = requiredCourses.length;
  const progressPercent = (fulfilled / total) * 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" />
          Courses Fulfilled for This Major
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress bar only */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{fulfilled} of {total} fulfilled</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        <Separator />

        {/* Required Courses list (clickable navigation) */}
        <div className="space-y-1">
          {requiredCourses.map((course, index) => {
            const comparison = courseComparisons[index];
            const isActive = index === currentCourseIndex;

            return (
              <button
                key={course.id}
                onClick={() => onSelectCourse(index)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-primary/10 border border-primary/30"
                )}
                aria-current={isActive ? "true" : undefined}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {course.status === "fulfilled" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    ) : course.status === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                    )}
                    <span className={cn(
                      "font-medium",
                      isActive ? "text-primary" : "text-foreground"
                    )}>
                      Course {index + 1} of {total}
                    </span>
                  </div>
                  <Badge
                    variant={
                      comparison?.overallDecision === "approved"
                        ? "success"
                        : comparison?.overallDecision === "denied"
                        ? "error"
                        : "warning"
                    }
                    className="text-[10px] px-1.5"
                  >
                    {comparison?.overallDecision === "approved"
                      ? "Approved"
                      : comparison?.overallDecision === "denied"
                      ? "Denied"
                      : "Pending"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between mt-1 ml-6">
                  <span className="text-xs text-muted-foreground">
                    {course.courseNumber}
                  </span>
                  {course.matchedTransferCourse && (
                    <span className="text-xs text-muted-foreground">
                      from {course.matchedTransferCourse}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
