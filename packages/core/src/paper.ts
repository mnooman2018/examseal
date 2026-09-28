export type MasterQuestion = {
  id: string;
  wordings: [string, string];
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
};

export type MasterPaper = {
  version: 1;
  title: string;
  subject: string;
  durationMinutes: number;
  instructions: string;
  questions: MasterQuestion[];
};
