import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CourseComparison } from "@/types/course";

interface CourseNavigationProps {
  courses: CourseComparison[];
  currentIndex: number;
  onSelectCourse: (index: number) => void;
}

export function CourseNavigation({
  courses,
  currentIndex,
  onSelectCourse,
}: CourseNavigationProps) {
  return (
    <nav className="space-y-1" aria-label="Course navigation">
      {courses.map((course, index) => (
        <button
          key={course.id}
          className={cn(
            "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            index === currentIndex
              ? "bg-primary/10 text-primary font-semibold"
              : "text-muted-foreground"
          )}
          onClick={() => onSelectCourse(index)}
          aria-current={index === currentIndex ? "true" : undefined}
        >
          <div className="flex items-center justify-between">
            <span>Course {index + 1} of {courses.length}</span>
            <Badge
              variant={
                course.overallDecision === "approved"
                  ? "success"
                  : course.overallDecision === "denied"
                  ? "error"
                  : "warning"
              }
              className="text-[10px] px-1.5"
            >
              {course.overallDecision === "approved"
                ? "Approved"
                : course.overallDecision === "denied"
                ? "Denied"
                : "Pending"}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground block mt-0.5">
            {course.transferCourse.courseNumber} → {course.equivalentCourse.courseNumber}
          </span>
        </button>
      ))}
    </nav>
  );
}
