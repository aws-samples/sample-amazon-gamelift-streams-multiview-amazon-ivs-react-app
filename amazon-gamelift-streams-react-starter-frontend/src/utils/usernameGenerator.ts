/**
 * Username Generator Utility
 * Generates random usernames in the format: AdjectiveAnimal### (e.g., "LazyTiger568")
 */

const adjectives = [
  'Brave',
  'Clever',
  'Eager',
  'Fierce',
  'Gentle',
  'Happy',
  'Jolly',
  'Kind',
  'Lazy',
  'Mighty',
  'Noble',
  'Quick',
  'Rapid',
  'Silent',
  'Swift',
  'Wise',
  'Bold',
  'Calm',
  'Daring',
  'Energetic',
  'Fearless',
  'Graceful',
  'Humble',
  'Lively',
  'Peaceful',
  'Proud',
  'Steady',
  'Vibrant',
  'Wild',
  'Zealous'
];

const animals = [
  'Bear',
  'Cat',
  'Dog',
  'Eagle',
  'Fox',
  'Hawk',
  'Lion',
  'Owl',
  'Panda',
  'Rabbit',
  'Tiger',
  'Wolf',
  'Deer',
  'Falcon',
  'Jaguar',
  'Leopard',
  'Otter',
  'Panther',
  'Raven',
  'Shark',
  'Snake',
  'Turtle',
  'Whale',
  'Zebra',
  'Badger',
  'Cheetah',
  'Dolphin',
  'Elephant',
  'Giraffe',
  'Koala'
];

/**
 * Generates a random username in the format: AdjectiveAnimal###
 * @returns A random username string (e.g., "LazyTiger568")
 */
export function generateUsername(): string {
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  const randomNumber = Math.floor(Math.random() * 900) + 100; // 3-digit number (100-999)

  return `${randomAdjective}${randomAnimal}${randomNumber}`;
}
