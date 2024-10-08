import { multicall } from '../../utils';
import { BigNumber } from '@ethersproject/bignumber';
import { formatUnits } from '@ethersproject/units';

export const author = 'pierremarsotlyon1';
export const version = '0.0.1';

// Used ABI
const abi = [
  'function balanceOf(address account) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)'
];

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
): Promise<Record<string, number>> {
  // Maximum of 5 multicall!
  if (options.twavpNumberOfBlocks > 5) {
    throw new Error('maximum of 5 call');
  }

  // Maximum of 20 whitelisted address
  if (options.whiteListedAddress.length > 20) {
    throw new Error('maximum of 20 whitelisted address');
  }

  // --- Create block number list for twavp
  // Obtain last block number
  // Create block tag
  let blockTag = 0;
  if (typeof snapshot === 'number') {
    blockTag = snapshot;
  } else {
    blockTag = await provider.getBlockNumber();
  }

  // Create block list
  const blockList = getPreviousBlocks(
    blockTag,
    options.twavpNumberOfBlocks,
    options.twavpDaysInterval,
    options.blockPerSec
  );

  // Query working balance of users
  const balanceOfQueries = addresses.map((address: any) => [
    options.sdTokenGauge,
    'balanceOf',
    [address]
  ]);

  const poolsCalls: any[] = options.pools.map((pool: string) => [
    pool,
    'balances',
    [options.indexSdTokenInPool]
  ]);

  // Execute multicall `sampleStep` times
  const response: any[] = [];
  for (let i = 0; i < options.twavpNumberOfBlocks; i++) {
    // Use good block number
    blockTag = blockList[i];

    const queries = [...balanceOfQueries];

    if (i === options.twavpNumberOfBlocks - 1) {
      queries.push(...poolsCalls);
    }

    response.push(
      await multicall(network, provider, abi, queries, { blockTag })
    );
  }

  let liquidityVoteFee = 0;
  if (options.pools.length > 0) {
    liquidityVoteFee = options.pools
      .map(() =>
        parseFloat(formatUnits(response[response.length - 1].pop()[0], 18))
      )
      .reduce((acc: number, balance: number) => acc + balance, 0);
  }

  return Object.fromEntries(
    Array(addresses.length)
      .fill('x')
      .map((_, i) => {
        // Init array of working balances for user
        const userBalances: BigNumber[] = [];

        for (let j = 0; j < options.twavpNumberOfBlocks; j++) {
          const balance = response[j].shift()[0];
          userBalances.push(balance);
        }

        if (addresses[i].toLowerCase() === options.botAddress.toLowerCase()) {
          return [addresses[i], Number(liquidityVoteFee)];
        } else {
          // Get average balance
          const averageBalanceOf = parseFloat(
            formatUnits(
              average(userBalances, addresses[i], options.whiteListedAddress),
              options.decimals
            )
          );

          // Return address and voting power
          return [addresses[i], Number(averageBalanceOf)];
        }
      })
  );
}

function getPreviousBlocks(
  currentBlockNumber: number,
  numberOfBlocks: number,
  daysInterval: number,
  blockPerSec: number
): number[] {
  const blocksPerDay = 86400 / blockPerSec;

  // Calculate total blocks interval
  const totalBlocksInterval = blocksPerDay * daysInterval;
  // Calculate block interval
  const blockInterval = totalBlocksInterval / (numberOfBlocks - 1);

  // Init array of block numbers
  const blockNumbers: number[] = [];

  for (let i = 0; i < numberOfBlocks; i++) {
    // Calculate block number
    const blockNumber =
      currentBlockNumber - totalBlocksInterval + blockInterval * i;
    // Add block number to array
    blockNumbers.push(Math.round(blockNumber));
  }

  // Return array of block numbers
  return blockNumbers;
}

function average(
  numbers: BigNumber[],
  address: string,
  whiteListedAddress: string[]
): BigNumber {
  // If no numbers, return 0 to avoid division by 0.
  if (numbers.length === 0) return BigNumber.from(0);

  // If address is whitelisted, return most recent working balance. i.e. no twavp applied.
  if (whiteListedAddress.includes(address)) return numbers[numbers.length - 1];

  // Init sum
  let sum = BigNumber.from(0);
  // Loop through all elements and add them to sum
  for (let i = 0; i < numbers.length; i++) {
    sum = sum.add(numbers[i]);
  }

  // Return sum divided by array length to get mean
  return sum.div(numbers.length);
}
