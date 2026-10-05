import { randomInt } from "node:crypto";

// Concrete, drawable nouns and a few short phrases. Lowercase; spaces are shown to guessers.
export const WORDS: readonly string[] = [
  // animals
  "cat", "dog", "elephant", "giraffe", "penguin", "octopus", "snail", "turtle", "rabbit", "shark",
  "whale", "spider", "butterfly", "snake", "frog", "owl", "kangaroo", "camel", "zebra", "lion",
  "monkey", "bee", "crab", "dolphin", "duck", "horse", "jellyfish", "ladybug", "mouse", "parrot",
  "pig", "squirrel", "flamingo", "hedgehog", "peacock", "bat", "dinosaur", "unicorn", "dragon", "fish",
  // food
  "banana", "pizza", "apple", "burger", "carrot", "cheese", "cookie", "donut", "egg", "grapes",
  "ice cream", "lemon", "watermelon", "pineapple", "popcorn", "sandwich", "taco", "cake", "cupcake", "hot dog",
  "pancake", "pretzel", "strawberry", "sushi", "mushroom", "corn", "cherry", "broccoli", "noodles", "toast",
  // household
  "chair", "table", "lamp", "bed", "clock", "door", "window", "key", "toothbrush", "umbrella",
  "scissors", "candle", "mirror", "bathtub", "pillow", "spoon", "fork", "cup", "teapot", "bucket",
  "broom", "ladder", "hammer", "light bulb", "fridge", "sofa", "basket", "bottle", "envelope", "glasses",
  // things
  "rocket", "computer", "guitar", "airplane", "football", "bicycle", "camera", "drum", "kite", "balloon",
  "anchor", "backpack", "book", "crown", "diamond", "flag", "gift", "hat", "headphones", "helmet",
  "magnet", "map", "medal", "microphone", "paintbrush", "pencil", "piano", "robot", "rope", "skateboard",
  "sock", "sunglasses", "sword", "telescope", "tent", "trophy", "violin", "wallet", "whistle", "boot",
  "car", "bus", "train", "boat", "submarine", "helicopter", "tractor", "truck", "ambulance", "parachute",
  "phone", "television", "keyboard", "battery", "compass", "dice", "hourglass", "lock", "necklace", "ring",
  // places and nature
  "mountain", "volcano", "island", "castle", "bridge", "lighthouse", "pyramid", "igloo", "windmill", "tornado",
  "rainbow", "cloud", "lightning", "snowman", "sun", "moon", "star", "tree", "flower", "cactus",
  "leaf", "river", "waterfall", "desert", "beach", "cave", "forest", "planet", "comet", "fire",
  "house", "school", "hospital", "farm", "barn", "fountain", "statue", "traffic light", "skyscraper", "tower",
  // people and actions
  "pirate", "astronaut", "wizard", "ghost", "vampire", "zombie", "ninja", "king", "queen", "mermaid",
  "clown", "doctor", "chef", "farmer", "knight", "alien", "angel", "baby", "superhero", "witch",
  "sleeping", "dancing", "swimming", "running", "jumping", "fishing", "juggling", "surfing", "skiing", "reading",
  // body and misc
  "eye", "nose", "ear", "hand", "foot", "tooth", "heart", "skeleton", "brain", "mustache",
  "spaceship", "treasure", "snowflake", "fireworks", "campfire", "spider web", "birthday", "music", "shadow", "magic",
];

/** Pick `count` distinct random words. */
export const pickWords = (count: number): string[] => {
  const picked = new Set<string>();
  while (picked.size < Math.min(count, WORDS.length)) {
    const word = WORDS[randomInt(WORDS.length)];
    if (word) picked.add(word);
  }
  return [...picked];
};
