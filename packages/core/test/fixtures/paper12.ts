import type { MasterPaper } from "../../src/paper";

// Test fixture only. The demo paper is demo-data/master-paper.json (authored by Dhruva).
export const paper12: MasterPaper = {
  version: 1,
  title: "Fixture Examination",
  subject: "Computer Science Fundamentals",
  durationMinutes: 30,
  instructions: "Answer all questions. Each question carries one mark.",
  questions: [
    {
      id: "Q01",
      wordings: [
        "Which data structure follows the First-In-First-Out principle?",
        "Which data structure processes its elements in First-In-First-Out order?",
      ],
      options: ["Stack", "Queue", "Binary tree", "Hash table"],
      answerIndex: 1,
    },
    {
      id: "Q02",
      wordings: [
        "What is the time complexity of binary search on a sorted array?",
        "How many steps, asymptotically, does binary search need on a sorted list?",
      ],
      options: ["Constant", "Logarithmic", "Linear", "Quadratic"],
      answerIndex: 1,
    },
    {
      id: "Q03",
      wordings: [
        "Which layer of the OSI model is responsible for routing packets?",
        "In the OSI reference model, which layer decides packet routes between networks?",
      ],
      options: ["Physical layer", "Data link layer", "Network layer", "Transport layer"],
      answerIndex: 2,
    },
    {
      id: "Q04",
      wordings: [
        "Which SQL command removes all rows from a table but keeps its structure?",
        "What SQL statement deletes every row of a table while preserving the table definition?",
      ],
      options: ["DROP", "TRUNCATE", "ALTER", "UPDATE"],
      answerIndex: 1,
    },
    {
      id: "Q05",
      wordings: [
        "What does CPU stand for in computer architecture?",
        "In computer hardware, the abbreviation CPU is short for what?",
      ],
      options: ["Central Processing Unit", "Central Program Utility", "Computer Personal Unit", "Core Processing Utility"],
      answerIndex: 0,
    },
    {
      id: "Q06",
      wordings: ["How many bits make up one byte?", "A single byte consists of how many binary digits?"],
      options: ["4", "8", "16", "32"],
      answerIndex: 1,
    },
    {
      id: "Q07",
      wordings: [
        "Which sorting algorithm has a worst-case running time of O(n log n)?",
        "Among these sorting methods, which one guarantees O(n log n) even in the worst case?",
      ],
      options: ["Bubble sort", "Insertion sort", "Merge sort", "Selection sort"],
      answerIndex: 2,
    },
    {
      id: "Q08",
      wordings: [
        "Which protocol translates domain names into IP addresses?",
        "What service maps human-readable domain names to their numeric IP addresses?",
      ],
      options: ["DNS", "DHCP", "FTP", "SMTP"],
      answerIndex: 0,
    },
    {
      id: "Q09",
      wordings: [
        "In object-oriented programming, what is bundling data with the methods that act on it called?",
        "What OOP concept describes wrapping data and its related methods into a single unit?",
      ],
      options: ["Inheritance", "Polymorphism", "Encapsulation", "Abstraction"],
      answerIndex: 2,
    },
    {
      id: "Q10",
      wordings: [
        "Which logic gate outputs true only when both of its inputs are true?",
        "What gate produces a high output only if all of its inputs are high?",
      ],
      options: ["OR gate", "AND gate", "XOR gate", "NOR gate"],
      answerIndex: 1,
    },
    {
      id: "Q11",
      wordings: [
        "What is the decimal value of the binary number 1011?",
        "Converting the binary number 1011 to base ten gives which value?",
      ],
      options: ["9", "10", "11", "13"],
      answerIndex: 2,
    },
    {
      id: "Q12",
      wordings: [
        "Which memory type loses its contents when the power is switched off?",
        "What kind of memory is volatile and gets erased once power is removed?",
      ],
      options: ["ROM", "RAM", "Flash memory", "Hard disk"],
      answerIndex: 1,
    },
  ],
};
