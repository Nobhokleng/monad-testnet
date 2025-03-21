const ethers = require('ethers');
const colors = require('colors');
const displayHeader = require('../src/displayHeader.js');
const readline = require('readline');
const axios = require('axios');
const fs = require('fs');
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require('worker_threads');

displayHeader();

// Konfigurasi tetap (bukan dari .env)
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const contractAddress = '0xb2f82D0f38dc453D596Ad40A37799446Cc89274A';
const gasLimitStake = 100000;
const gasLimitUnstake = 160000;
const gasLimitClaim = 160000;

const minimalABI = [
  'function getPendingUnstakeRequests(address) view returns (uint256[] memory)',
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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
  const minDelay = 0.30 * 60 * 1000;
  const maxDelay = 1.15 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, provider, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to stake MON...`.magenta);
    const stakeAmount = getRandomAmount();
    console.log(
      `Random stake amount: ${ethers.utils.formatEther(stakeAmount)} MON`
    );
    const data =
      '0x6e553f65' +
      ethers.utils.hexZeroPad(stakeAmount.toHexString(), 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2);
    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitStake),
      value: stakeAmount,
    };
    console.log('🔄 Sending stake transaction...');
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );
    console.log('Waiting for transaction confirmation...');
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake successful!`.green.underline);
    return { receipt, stakeAmount };
  } catch (error) {
    console.error('❌ Staking failed:'.red, error.message);
    throw error;
  }
}

async function requestUnstakeAprMON(
  wallet,
  provider,
  amountToUnstake,
  cycleNumber
) {
  try {
    console.log(
      `\n[Cycle ${cycleNumber}] Preparing to request unstake aprMON...`.magenta
    );
    console.log(
      `Amount to request unstake: ${ethers.utils.formatEther(
        amountToUnstake
      )} aprMON`
    );
    const data =
      '0x7d41c86e' +
      ethers.utils.hexZeroPad(amountToUnstake.toHexString(), 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2);
    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitUnstake),
      value: ethers.utils.parseEther('0'),
    };
    console.log('🔄 Sending unstake request transaction...');
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );
    console.log('🔄 Waiting for transaction confirmation...');
    const receipt = await txResponse.wait();
    console.log(`✔️  Unstake request successful!`.green.underline);
    return receipt;
  } catch (error) {
    console.error('❌ Unstake request failed:'.red, error.message);
    throw error;
  }
}

async function checkClaimableStatus(walletAddress) {
  try {
    const apiUrl = `https://liquid-staking-backend-prod-b332fbe9ccfe.herokuapp.com/withdrawal_requests?address=${walletAddress}`;
    const response = await axios.get(apiUrl);
    const claimableRequest = response.data.find(
      (request) => !request.claimed && request.is_claimable
    );
    if (claimableRequest) {
      console.log(`Found claimable request ID: ${claimableRequest.id}`);
      return {
        id: claimableRequest.id,
        isClaimable: true,
      };
    }
    return {
      id: null,
      isClaimable: false,
    };
  } catch (error) {
    console.error(
      '❌ Failed to check claimable status from API:'.red,
      error.message
    );
    return {
      id: null,
      isClaimable: false,
    };
  }
}

async function claimMON(wallet, provider, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Checking claimable withdrawals...`);
    const { id, isClaimable } = await checkClaimableStatus(wallet.address);
    if (!isClaimable || !id) {
      console.log('No claimable withdrawals found at this time');
      return null;
    }
    console.log(`Preparing to claim withdrawal request ID: ${id}`);
    const data =
      '0x492e47d2' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2) +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      ethers.utils
        .hexZeroPad(ethers.BigNumber.from(id).toHexString(), 32)
        .slice(2);
    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitClaim),
      value: ethers.utils.parseEther('0'),
    };
    console.log('Sending claim transaction...');
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`Transaction sent: ${EXPLORER_URL}${txResponse.hash}`);
    console.log('Waiting for transaction confirmation...');
    const receipt = await txResponse.wait();
    console.log(`Claim successful for request ID: ${id}`.green.underline);
    return receipt;
  } catch (error) {
    console.error('Claim failed:', error.message);
    throw error;
  }
}

async function runCycle(wallet, provider, cycleNumber) {
  try {
    console.log(`\n=== Starting Cycle ${cycleNumber} ===`);
    
    const { stakeAmount } = await stakeMON(wallet, provider, cycleNumber);

    const delayTimeBeforeUnstake = getRandomDelay();
    console.log(`🔄 Waiting for ${delayTimeBeforeUnstake / 1000} seconds before requesting unstake...`);
    await delay(delayTimeBeforeUnstake);

    // Generate a random percentage between 7.5% and 15% to leave behind
    const remainingPercentage = Math.random() * (5 - 2.5) + 2.5;
    // Convert remaining percentage to a multiplier (i.e., 0.0918 for 9.18%)
    const multiplier = 1 - (remainingPercentage / 100);
    const amountToUnstake = stakeAmount.mul(ethers.BigNumber.from(Math.floor(multiplier * 1000000).toString())).div(ethers.BigNumber.from('1000000'));

    console.log(`Amount to unstake: ${ethers.utils.formatEther(amountToUnstake)} gMON`);
    console.log(`Remaining amount to keep: ${ethers.utils.formatEther(stakeAmount - amountToUnstake)} gMON`);

    await requestUnstakeAprMON(wallet, provider, amountToUnstake, cycleNumber);

    console.log(`Waiting for 660 seconds (11 minutes) before checking claim status...`.magenta);
    await delay(660000);

    await claimMON(wallet, provider, cycleNumber);

    console.log(
      `=== Cycle ${cycleNumber} completed successfully! ===`.magenta.bold
    );
  } catch (error) {
    console.error(`❌ Cycle ${cycleNumber} failed:`.red, error.message);
    throw error;
  }
}

function getCycleCount() {
  return new Promise((resolve) => {
    rl.question('How many staking cycles would you like to run? ', (answer) => {
      const cycleCount = parseInt(answer);
      if (isNaN(cycleCount) || cycleCount <= 0) {
        console.error('Please enter a valid positive number!'.red);
        rl.close();
        process.exit(1);
      }
      resolve(cycleCount);
    });
  });
}

if (isMainThread) {
  // Main thread logic
  async function main() {
    try {
      console.log('Starting aPriori Staking operations...'.green);
      const cycleCount = await getCycleCount();
      console.log(`Running ${cycleCount} cycles...`.yellow);

      const workers = [];
      for (let i = 0; i < wallets.length; i++) {
        const privateKey = wallets[i].trim();
        const proxy = proxies[i % proxies.length].trim();

        // Create a worker for each account
        const worker = new Worker(__filename, {
          workerData: { privateKey, proxy, cycleCount },
        });

        workers.push(worker);

        worker.on('message', (message) => {
          console.log(message);
        });

        worker.on('error', (error) => {
          console.error(`Worker error: ${error.message}`.red);
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`Worker stopped with exit code ${code}`.red);
          }
        });
      }

      // Wait for all workers to finish
      await Promise.all(workers.map((worker) => worker.terminate()));
      console.log(
        `\nAll ${cycleCount} cycles completed successfully for all accounts!`
          .green.bold
      );
    } catch (error) {
      console.error('Operation failed:'.red, error.message);
    } finally {
      rl.close();
    }
  }

  main();
} else {
  // Worker thread logic
  const { privateKey, proxy, cycleCount } = workerData;

  const provider = new ethers.providers.JsonRpcProvider({
    url: RPC_URL,
    headers: {
      'Proxy-Authorization': `Basic ${Buffer.from(proxy.split('@')[0]).toString(
        'base64'
      )}`,
    },
  });

  const wallet = new ethers.Wallet(privateKey, provider);

  parentPort.postMessage(
    `\nStarting operations for account ${wallet.address} using proxy ${proxy}`
      .cyan
  );

  (async () => {
    for (let j = 1; j <= cycleCount; j++) {
      await runCycle(wallet, provider, j);
      if (j < cycleCount) {
        const interCycleDelay = getRandomDelay();
        parentPort.postMessage(
          `\nWaiting ${interCycleDelay / 1000} seconds before next cycle...`
        );
        await delay(interCycleDelay);
      }
    }
    parentPort.postMessage(
      `\nAll ${cycleCount} cycles completed successfully for account ${wallet.address}!`
        .green.bold
    );
  })();
}
