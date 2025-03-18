require('dotenv').config();
const { ethers } = require('ethers');
const colors = require('colors');
const readline = require('readline');
const fs = require('fs');
const displayHeader = require('../src/displayHeader.js');
displayHeader();

const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const WMON_CONTRACT = '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701';
const gasLimitWrap = 50000;
const gasLimitUnwrap = 80000;

// Membaca daftar private key dari file wallet.txt
const wallets = fs
  .readFileSync('wallet.txt', 'utf8')
  .split('\n')
  .filter(Boolean);

// Membaca daftar proxy dari file proxy.txt
const proxies = fs
  .readFileSync('proxy.txt', 'utf8')
  .split('\n')
  .filter(Boolean);

if (wallets.length === 0 || proxies.length === 0) {
  console.error('Please ensure wallet.txt and proxy.txt are not empty.'.red);
  process.exit(1);
}

function getRandomAmount() {
  const min = 0.015;
  const max = 0.085;
  const randomAmount = Math.random() * (max - min) + min;
  return ethers.utils.parseEther(randomAmount.toFixed(4));
}

function getRandomDelay() {
  const minDelay = 0.25 * 60 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

async function wrapMON(wallet, amount) {
  try {
    console.log(
      `🔄 Wrapping ${ethers.utils.formatEther(amount)} MON into WMON...`.magenta
    );
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        'function deposit() public payable',
        'function withdraw(uint256 amount) public',
      ],
      wallet
    );
    const tx = await contract.deposit({ value: amount, gasLimit: gasLimitWrap });
    console.log(`✔️  Wrap MON → WMON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
  } catch (error) {
    console.error('❌ Error wrapping MON:'.red, error);
  }
}

async function unwrapMON(wallet, amount) {
  try {
    console.log(
      `🔄 Unwrapping ${ethers.utils.formatEther(amount)} WMON back to MON...`
        .magenta
    );
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        'function deposit() public payable',
        'function withdraw(uint256 amount) public',
      ],
      wallet
    );
    const tx = await contract.withdraw(amount, { gasLimit: gasLimitUnwrap });
    console.log(`✔️  Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
  } catch (error) {
    console.error('❌ Error unwrapping WMON:'.red, error);
  }
}

async function runSwapCycle(wallet, cycles, interval) {
  let cycleCount = 0;

  if (interval) {
    const intervalId = setInterval(async () => {
      if (cycleCount < cycles) {
        const randomAmount = getRandomAmount();
        const randomDelay = getRandomDelay();
        console.log(`Cycle ${cycleCount + 1} of ${cycles}:`.magenta);
        await wrapMON(wallet, randomAmount);
        await unwrapMON(wallet, randomAmount);
        cycleCount++;
        console.log(
          `Next cycle will be after ${randomDelay / 1000 / 60} minute(s)`.yellow
        );
      } else {
        clearInterval(intervalId);
        console.log(`All ${cycles} cycles completed`.green);
      }
    }, interval * 60 * 60 * 1000);
  } else {
    for (let i = 0; i < cycles; i++) {
      const randomAmount = getRandomAmount();
      const randomDelay = getRandomDelay();
      console.log(`Cycle ${i + 1} of ${cycles}:`.magenta);
      await wrapMON(wallet, randomAmount);
      await unwrapMON(wallet, randomAmount);
      console.log(
        `Waiting for ${randomDelay / 1000 / 60} minute(s) before next cycle...`
          .yellow
      );
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
    console.log(`All ${cycles} cycles completed`.green);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question(
  'How many swap cycles would you like to run? (Press enter to skip): ',
  (cycles) => {
    rl.question(
      'How often (in hours) would you like the cycle to run? (Press enter to skip): ',
      (hours) => {
        let cyclesCount = cycles ? parseInt(cycles) : 1;
        let intervalHours = hours ? parseInt(hours) : null;

        if (
          isNaN(cyclesCount) ||
          (intervalHours !== null && isNaN(intervalHours))
        ) {
          console.log('❌ Invalid input. Please enter valid numbers.'.red);
          rl.close();
          return;
        }

        console.log(
          `Starting ${cyclesCount} swap cycles ${
            intervalHours ? `every ${intervalHours} hour(s)` : 'immediately'
          }...`
        );

        // Jalankan swap cycle untuk setiap akun
        for (let i = 0; i < wallets.length; i++) {
          const privateKey = wallets[i].trim();
          const proxy = proxies[i % proxies.length].trim();

          const provider = new ethers.providers.JsonRpcProvider({
            url: RPC_URL,
            headers: {
              'Proxy-Authorization': `Basic ${Buffer.from(
                proxy.split('@')[0]
              ).toString('base64')}`,
            },
          });

          const wallet = new ethers.Wallet(privateKey, provider);

          console.log(
            `\nStarting operations for account ${wallet.address} using proxy ${proxy}`
              .cyan
          );

          runSwapCycle(wallet, cyclesCount, intervalHours);
        }

        rl.close();
      }
    );
  }
);
