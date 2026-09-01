import type { Subject } from '@/lib/schedule/types';
import { subjectColorAt } from '@/lib/schedule/subject-palette';

export const subjects: Subject[] = [
  { id: 'electronics', offeringId: 'OFF-ELECTRONICS-26', externalCode: '564966', name: 'Electronics and Digital Electronics', shortName: 'Electronics', color: subjectColorAt(0), selectedGroup: 5, availableGroups: [5] },
  { id: 'scrum-framework', offeringId: 'OFF-SCRUM-26', externalCode: '565095', name: 'Scrum Framework Fundamentals', shortName: 'Scrum Fundamentals', color: subjectColorAt(1), selectedGroup: 3, availableGroups: [1, 2, 3] },
  { id: 'web-security', offeringId: 'OFF-WEB-SECURITY-26', externalCode: '565115', name: 'Web Application Security', shortName: 'Web Security', color: subjectColorAt(2), selectedGroup: 4, availableGroups: [4] },
  { id: 'cryptonomics', offeringId: 'OFF-CRYPTONOMICS-26', externalCode: 'LOCAL-CRYPTONOMICS', name: 'Cryptonomics', shortName: 'Cryptonomics', color: subjectColorAt(3), selectedGroup: 2, availableGroups: [2] },
  { id: 'coding-systems', offeringId: 'OFF-CODING-SYSTEMS-26', externalCode: 'LOCAL-CODING-SYSTEMS', name: 'Information Coding Systems', shortName: 'Coding Systems', color: subjectColorAt(4), selectedGroup: 1, availableGroups: [1] },
  { id: 'qualification-work', offeringId: 'OFF-QUALIFICATION-26', externalCode: 'LOCAL-QUALIFICATION', name: 'Qualification Project', shortName: 'Qualification Project', color: subjectColorAt(5), selectedGroup: 2, availableGroups: [2] },
  { id: 'intelligent-networks', offeringId: 'OFF-INTELLIGENT-NETWORKS-26', externalCode: 'LOCAL-INTELLIGENT-NETWORKS', name: 'Intelligent Networks', shortName: 'Intelligent Networks', color: subjectColorAt(6), selectedGroup: 4, availableGroups: [4] },
  { id: 'parallel-programming', offeringId: 'OFF-PARALLEL-PROGRAMMING-26', externalCode: 'LOCAL-PARALLEL-PROGRAMMING', name: 'Multitasking and Parallel Programming', shortName: 'Parallel Programming', color: subjectColorAt(7), selectedGroup: 2, availableGroups: [2] },
];
