import { User, School, Hash, CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Student } from "@/types/student";

interface StudentInformationCardProps {
  student: Student;
}

export function StudentInformationCard({ student }: StudentInformationCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          Student Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground min-w-[130px]">Student Name:</span>
            <span className="font-semibold">{student.name}</span>
          </div>
          <Separator />
          <div className="flex items-start gap-2">
            <Hash className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground min-w-[110px]">Student ID:</span>
            <span>{student.studentId}</span>
          </div>
          <Separator />
          <div className="flex items-start gap-2">
            <School className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground min-w-[110px]">Transfer Institution:</span>
            <span>{student.transferInstitution}</span>
          </div>
          <Separator />
          <div className="flex items-start gap-2">
            <CalendarCheck className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground min-w-[110px]">Program:</span>
            <span className="font-semibold">{student.applyingFor}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
