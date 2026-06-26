// data/names.js — English name lists for random generation

const FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Christopher',
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth',
  'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
];

/**
 * Generate a random full name.
 * @returns {{ firstName: string, lastName: string }}
 */
function generateRandomName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return { firstName, lastName };
}

/**
 * Generate a random birthday (age 19-25).
 * @returns {{ year: number, month: number, day: number }}
 */
function generateRandomBirthday() {
  const currentYear = new Date().getFullYear();
  const age = 19 + Math.floor(Math.random() * 7); // 19 to 25
  const year = currentYear - age;
  const month = 1 + Math.floor(Math.random() * 12); // 1 to 12
  const maxDay = new Date(year, month, 0).getDate(); // days in that month
  const day = 1 + Math.floor(Math.random() * maxDay);
  return { year, month, day };
}
