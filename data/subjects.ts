import type { Subject } from '@/lib/schedule/types';

export const subjects: Subject[] = [
  { id: 'electronics', offeringId: 'OFF-ELECTRONICS-26', externalCode: '564966', name: 'Електроніка та цифрова електроніка', shortName: 'Електроніка', color: '#f59f65', selectedGroup: 5, availableGroups: [5] },
  { id: 'scrum-framework', offeringId: 'OFF-SCRUM-26', externalCode: '565095', name: 'Основи фреймворку Скрам', shortName: 'Основи Скрам', color: '#7b86c6', selectedGroup: 3, availableGroups: [3] },
  { id: 'web-security', offeringId: 'OFF-WEB-SECURITY-26', externalCode: '565115', name: 'Інформаційна безпека веб-застосунків', shortName: 'Безпека веб-застосунків', color: '#5f8fdb', selectedGroup: 4, availableGroups: [4] },
  { id: 'cryptonomics', offeringId: 'OFF-CRYPTONOMICS-26', externalCode: 'LOCAL-CRYPTONOMICS', name: 'Криптономіка', shortName: 'Криптономіка', color: '#4c9d8b', selectedGroup: 2, availableGroups: [2] },
  { id: 'coding-systems', offeringId: 'OFF-CODING-SYSTEMS-26', externalCode: 'LOCAL-CODING-SYSTEMS', name: 'Системи кодування інформації', shortName: 'Системи кодування', color: '#d87575', selectedGroup: 1, availableGroups: [1] },
  { id: 'qualification-work', offeringId: 'OFF-QUALIFICATION-26', externalCode: 'LOCAL-QUALIFICATION', name: 'Кваліфікаційна робота', shortName: 'Кваліфікаційна робота', color: '#a276c7', selectedGroup: 2, availableGroups: [2] },
  { id: 'intelligent-networks', offeringId: 'OFF-INTELLIGENT-NETWORKS-26', externalCode: 'LOCAL-INTELLIGENT-NETWORKS', name: 'Інтелектуальні мережі', shortName: 'Інтелектуальні мережі', color: '#9b8c51', selectedGroup: 4, availableGroups: [4] },
  { id: 'parallel-programming', offeringId: 'OFF-PARALLEL-PROGRAMMING-26', externalCode: 'LOCAL-PARALLEL-PROGRAMMING', name: 'Багатозадачне та паралельне програмування', shortName: 'Паралельне програмування', color: '#5c7e83', selectedGroup: 2, availableGroups: [2] },
];
