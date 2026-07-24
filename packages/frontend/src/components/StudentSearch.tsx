import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { mockStudents } from "@/mock/students";
import { Student } from "@/types/student";

interface StudentSearchProps {
  onStudentSelect: (student: Student) => void;
}

export function StudentSearch({ onStudentSelect }: StudentSearchProps) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  const filteredStudents = mockStudents.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.studentId.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (student: Student) => {
    onStudentSelect(student);
    setQuery(student.name);
    setShowResults(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search student by name or ID..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(e.target.value.length > 0);
            }}
            onFocus={() => query.length > 0 && setShowResults(true)}
            className="pl-9"
            aria-label="Search student"
          />
        </div>
        <Button variant="outline" size="sm">
          <Search className="h-4 w-4 mr-1" />
          Search Student
        </Button>
      </div>

      {/* Search Results Dropdown */}
      {showResults && filteredStudents.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10">
          {filteredStudents.map((student) => (
            <button
              key={student.id}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center justify-between text-sm"
              onClick={() => handleSelect(student)}
            >
              <span className="font-medium">{student.name}</span>
              <span className="text-muted-foreground">{student.studentId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
