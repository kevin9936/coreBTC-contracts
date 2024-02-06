import {expect} from "chai";
import {deployments, ethers} from "hardhat";
import {Signer} from "ethers";
import {deployMockContract, MockContract} from "@ethereum-waffle/mock-contract";

import {PriceOracle} from "../src/types/PriceOracle";
import {PriceOracle__factory} from "../src/types/factories/PriceOracle__factory";
import {Erc20} from "../src/types/ERC20";
import {Erc20__factory} from "../src/types/factories/Erc20__factory";

import {CoreBTCLogic} from "../src/types/CoreBTCLogic";
import {CoreBTCLogic__factory} from "../src/types/factories/CoreBTCLogic__factory";
import {CoreBTCProxy__factory} from "../src/types/factories/CoreBTCProxy__factory";

import {takeSnapshot, revertProvider} from "./block_utils";


describe("PriceOracle", async () => {

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000001";
    let TWO_ADDRESS = "0x0000000000000000000000000000000000000002";

    // Accounts
    let deployer: Signer;
    let signer1: Signer;
    let deployerAddress: string;
    let signer1Address: string;

    // Contracts
    let priceOracle: PriceOracle;
    let erc20: Erc20;
    let _erc20: Erc20;
    let coreBTC: CoreBTCLogic;

    // Mock contracts
    let mockPriceProxy: MockContract;
    let _mockPriceProxy: MockContract;

    // Values
    let acceptableDelay: number;

    let snapshotId: any;

    before(async () => {
        // Sets accounts
        [deployer, signer1] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();

        // Deploys erc20 contracts
        const erc20Factory = new Erc20__factory(deployer);
        erc20 = await erc20Factory.deploy(
            "TestToken",
            "TT",
            1000
        );
        _erc20 = await erc20Factory.deploy(
            "AnotherTestToken",
            "ATT",
            1000
        );

        // Deploys collateralPool contract
        acceptableDelay = 120; // seconds
        const PriceOracleFactory = new PriceOracle__factory(deployer);
        priceOracle = await PriceOracleFactory.deploy(acceptableDelay)
        coreBTC = await deployCoreBTC();
        const IPriceProxy = await deployments.getArtifact(
            "IPriceProxy"
        );
        mockPriceProxy = await deployMockContract(
            deployer,
            IPriceProxy.abi
        );
        _mockPriceProxy = await deployMockContract(
            deployer,
            IPriceProxy.abi
        );

        await priceOracle.addTokenPricePair(erc20.address, 'TT/USDT');
        await priceOracle.addTokenPricePair(_erc20.address, 'ATT/USDT');
        await priceOracle.addTokenPricePair(coreBTC.address, 'BTC/USDT');
        await priceOracle.addPriceProxy(_mockPriceProxy.address)
        await priceOracle.addPriceProxy(mockPriceProxy.address)

    });
    const deployCoreBTC = async (
        _signer?: Signer
    ): Promise<CoreBTCLogic> => {
        const coreBTCLogicFactory = new CoreBTCLogic__factory(deployer);
        const coreBTCLogicImpl = await coreBTCLogicFactory.deploy();
        const methodSig = ethers.utils.id(
            "initialize(string,string)"
        );
        const tokenName = "coreBTC";
        const tokenSymbol = "CBTC";
        const params = ethers.utils.defaultAbiCoder.encode(
            ['string', 'string'],
            [tokenName, tokenSymbol]
        );
        const initCode = ethers.utils.solidityPack(
            ['bytes', 'bytes'],
            [methodSig.slice(0, 10), params]
        );
        const coreBTCProxyFactory = new CoreBTCProxy__factory(deployer);
        const coreBTCProxy = await coreBTCProxyFactory.deploy(
            coreBTCLogicImpl.address,
            initCode
        );
        coreBTC = await coreBTCLogicFactory.attach(
            coreBTCProxy.address
        )
        return coreBTC;
    };

    async function setNextBlockTimestamp(
        addedTimestamp: number,
    ): Promise<void> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        let lastBlockTimestamp = lastBlock.timestamp;
        await ethers.provider.send("evm_setNextBlockTimestamp", [lastBlockTimestamp + addedTimestamp])
        await ethers.provider.send("evm_mine", []);
    }

    async function getLastBlockTimestamp(): Promise<number> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        return lastBlock.timestamp;
    }

    async function mockFunctionsPriceProxy(
        price0: number,
        decimals0: number,
        publishTime0: number,
        price1: number,
        decimals1: number,
        publishTime1: number
    ): Promise<void> {
        let tokenPrice0: object = {price: price0, decimals: decimals0, publishTime: publishTime0};
        let tokenPrice1: object = {price: price1, decimals: decimals1, publishTime: publishTime1};
        let errmsg = 'test';
        await mockPriceProxy.mock.getEmaPricesByPairNames.returns(tokenPrice0, tokenPrice1, errmsg);
    }


    describe("#addTokenPricePair", async () => {

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });
        it("non owners can't call addTokenPricePair", async function () {
            let pricePairName = 'TEST/USDT'
            await expect(
                priceOracle.connect(signer1).addTokenPricePair(ONE_ADDRESS, pricePairName)
            ).to.revertedWith('Ownable: caller is not the owner');
        })
        it("does not allow token address to be zero", async function () {
            await expect(
                priceOracle.addTokenPricePair(ZERO_ADDRESS, 'TEST/USDT')
            ).to.revertedWith('PriceOracle: zero address');
            let thePricePairMap = await priceOracle.pricePairMap(ZERO_ADDRESS)
            expect(thePricePairMap).to.equal('')
        })
        it("does not allow invalid pair name in addTokenPricePair", async function () {
            await expect(priceOracle.addTokenPricePair(ONE_ADDRESS, ''))
                .to.revertedWith('PriceOracle: empty pair name')

        })
        it("successfully adds token-price pair", async function () {
            let pricePairName = 'TEST/USDT'
            await expect(
                priceOracle.addTokenPricePair(ONE_ADDRESS, pricePairName)
            ).to.emit(priceOracle, 'NewTokenPricePair').withArgs(
                ONE_ADDRESS,
                '',
                pricePairName
            );
            let thePricePairMap = await priceOracle.pricePairMap(ONE_ADDRESS)
            expect(pricePairName).to.equal(thePricePairMap)
        })

        it("successfully updates existing price pair", async function () {
            let pricePairNameBefore = 'TA/USDT'
            let pricePairNameAfter = 'TB/USDT'
            await expect(
                priceOracle.addTokenPricePair(ONE_ADDRESS, pricePairNameBefore)
            ).to.emit(priceOracle, 'NewTokenPricePair').withArgs(
                ONE_ADDRESS,
                '',
                pricePairNameBefore
            );
            await expect(
                priceOracle.addTokenPricePair(ONE_ADDRESS, pricePairNameAfter)
            ).to.emit(priceOracle, 'NewTokenPricePair').withArgs(
                ONE_ADDRESS,
                pricePairNameBefore,
                pricePairNameAfter
            );
            let thePricePairMap = await priceOracle.pricePairMap(ONE_ADDRESS)
            expect(thePricePairMap).to.equal(pricePairNameAfter)
        })

        it("does not allow adding duplicate pair name", async function () {
            await expect(
                priceOracle.addTokenPricePair(coreBTC.address, 'BTC/USDT')
            ).to.revertedWith('PriceOracle: price pair already exists');
        })

    });
    describe("#addPriceProxy", async () => {
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });
        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });
        it("non owners can't call addPriceProxy", async function () {
            await expect(
                priceOracle.connect(signer1).addPriceProxy(ONE_ADDRESS)
            ).to.revertedWith('Ownable: caller is not the owner');
        })
        it("does not allow zero proxy address", async function () {
            await expect(
                priceOracle.addPriceProxy(ZERO_ADDRESS)
            ).to.revertedWith('PriceOracle: zero address');
        })
        it("successfully adds Price Proxy", async function () {
            await expect(
                priceOracle.addPriceProxy(ONE_ADDRESS)
            ).to.emit(priceOracle, 'AddPriceProxy').withArgs(
                ONE_ADDRESS
            );
            let priceProxy = await priceOracle.priceProxyList(2)
            let priceProxyIndex = await priceOracle.priceProxyIdxMap(priceProxy)
            let PriceProxyListLength = await priceOracle.getPriceProxyListLength()
            expect(priceProxy).to.equal(ONE_ADDRESS)
            expect(priceProxyIndex).to.equal(3)
            expect(priceProxyIndex).to.equal(PriceProxyListLength)
        })
        it("prevents adding duplicate proxy address", async function () {
            await priceOracle.addPriceProxy(ONE_ADDRESS)
            await expect(priceOracle.addPriceProxy(ONE_ADDRESS)).revertedWith('PriceOracle: price proxy already exists')
        })
    });

    describe("#removePriceProxy", async () => {
        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });
        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });
        it("non owners can't call removePriceProxy", async function () {
            await expect(
                priceOracle.connect(signer1).removePriceProxy(ONE_ADDRESS)
            ).to.revertedWith('Ownable: caller is not the owner');
        })
        it("does not allow zero proxy address", async function () {
            await expect(
                priceOracle.removePriceProxy(ZERO_ADDRESS)
            ).to.revertedWith('PriceOracle: zero address');
        })
        it("reverts when attempting to remove non-existent proxy address", async function () {
            await expect(
                priceOracle.removePriceProxy(ONE_ADDRESS)
            ).to.revertedWith('PriceOracle: price proxy does not exists');
        })
        it("reverts when attempting to remove the best price proxy", async function () {
            await priceOracle.selectBestPriceProxy(mockPriceProxy.address)
            await expect(priceOracle.removePriceProxy(mockPriceProxy.address)).revertedWith('PriceOracle: can not remove best price proxy');
        })
        it("successfully removes Price Proxy", async function () {
            await priceOracle.addPriceProxy(ONE_ADDRESS)
            await priceOracle.addPriceProxy(TWO_ADDRESS)
            await expect(priceOracle.removePriceProxy(ONE_ADDRESS))
                .to.emit(priceOracle, 'RemovePriceProxy').withArgs(
                    ONE_ADDRESS
                )
            let priceProxyIndex0 = await priceOracle.priceProxyIdxMap(ONE_ADDRESS);
            expect(priceProxyIndex0).equal(0);
            let priceProxyIndex1 = await priceOracle.priceProxyIdxMap(TWO_ADDRESS);
            expect(priceProxyIndex1).equal(3);
            let priceProxy = await priceOracle.priceProxyList(2);
            expect(priceProxy).equal(TWO_ADDRESS);
        })
        it("successfully deletes the latest Price Proxy", async function () {
            await priceOracle.addPriceProxy(ONE_ADDRESS)
            await expect(priceOracle.removePriceProxy(ONE_ADDRESS))
                .to.emit(priceOracle, 'RemovePriceProxy').withArgs(
                    ONE_ADDRESS
                )
            let priceProxyIndex0 = await priceOracle.priceProxyIdxMap(mockPriceProxy.address);
            expect(priceProxyIndex0).equal(2);
        })


    });

    describe("#equivalentOutputAmount", async () => {
        let price: number;
        let timeStamp: number;
        let decimals: number;
        // ERC20 decimals
        let erc20Decimals: number;
        let btcDecimals: number;
        // Sets inputs values
        let amountIn = 10000; //  token
        let btcPrice = 1000;
        let erc20Price = 2000;
        let btcPriceDecimals = 2;
        let erc20PriceDecimals = 3;

        let inDecimals = 2;
        let outDecimals = 4;
        decimals = outDecimals - inDecimals

        price = btcPrice * Math.pow(10, erc20PriceDecimals - btcPriceDecimals) / erc20Price
        btcDecimals = 8;
        erc20Decimals = 18;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });


        it("equivalent output amount for the same token", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        inDecimals,
                        erc20.address,
                        erc20.address
                    )).to.equal(amountIn);
            }
        )

        it("equivalent output amount for the same token with different input precision", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                let newDecimals = btcPriceDecimals - 1
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        newDecimals,
                        erc20PriceDecimals,
                        erc20.address,
                        erc20.address
                    )).to.equal(amountIn * Math.pow(10, erc20PriceDecimals - newDecimals));
            }
        )
        it("reverts when attempting to use expired token price", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                const erc20Address = erc20.address.toLowerCase()
                const _erc20Address = _erc20.address.toLowerCase()
                const publishTime = timeStamp.toString(16)
                await setNextBlockTimestamp(240);
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp + 240, erc20Price, erc20PriceDecimals, timeStamp);
                await expect(
                    priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        erc20.address,
                        _erc20.address
                    )
                ).to.be.revertedWith("" +
                    "PriceOracle: price is expired, token " + _erc20Address + ", publishTime 0x" + publishTime);
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp, erc20Price, erc20PriceDecimals, timeStamp);
                await expect(
                    priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        erc20.address,
                        _erc20.address
                    )
                ).to.be.revertedWith(
                    "PriceOracle: price is expired, token " + erc20Address + ", publishTime 0x" + publishTime);
            }
        )
        it("recovers when bestPriceProxy address is zero", async function () {
                timeStamp = await getLastBlockTimestamp();
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp, erc20Price, erc20PriceDecimals, timeStamp);
                await expect(
                    priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        erc20.address,
                        _erc20.address
                    )
                ).to.be.revertedWith("PriceOracle: best price proxy is empty");
            }
        )
        it("retrieves price by calling alternative proxy", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                await mockFunctionsPriceProxy(0, btcPriceDecimals, timeStamp, erc20Price, erc20PriceDecimals, timeStamp);
                let tokenPrice0: object = {price: btcPrice, decimals: btcPriceDecimals, publishTime: timeStamp};
                let tokenPrice1: object = {price: erc20Price, decimals: erc20PriceDecimals, publishTime: timeStamp};
                await _mockPriceProxy.mock.getEmaPricesByPairNames.returns(tokenPrice0, tokenPrice1, '');
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        inDecimals,
                        coreBTC.address,
                        erc20.address
                    )
                ).to.equal(amountIn * price);
            }
        )
        it("reverts when token address is zero", async function () {
                await expect(
                    priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        ZERO_ADDRESS,
                        erc20.address
                    )
                ).to.revertedWith("PriceOracle: zero address");
            }
        )


        it("Gets equal amount of output token when delay is acceptable", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp, erc20Price, erc20PriceDecimals, timeStamp);
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        inDecimals,
                        coreBTC.address,
                        erc20.address
                    )).to.equal(amountIn * price);
            }
        )

        it("Gets equivalent output tokens with uniform price precision", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp, erc20Price, btcPriceDecimals, timeStamp);
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        coreBTC.address,
                        erc20.address
                    )).to.equal(amountIn / 2 * Math.pow(10, decimals));
            }
        )
        it("successfully calculates equivalent output amount", async function () {
                timeStamp = await getLastBlockTimestamp();
                await priceOracle.selectBestPriceProxy(mockPriceProxy.address);
                await mockFunctionsPriceProxy(btcPrice, btcPriceDecimals, timeStamp, erc20Price, erc20PriceDecimals, timeStamp);
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        coreBTC.address,
                        erc20.address
                    )).to.equal(amountIn * price * Math.pow(10, decimals));
                await mockFunctionsPriceProxy(erc20Price, erc20PriceDecimals, timeStamp, btcPrice, btcPriceDecimals, timeStamp);
                expect(
                    await priceOracle.equivalentOutputAmount(
                        amountIn,
                        inDecimals,
                        outDecimals,
                        erc20.address,
                        coreBTC.address
                    )).to.equal(amountIn / price * Math.pow(10, decimals));
            }
        )

    });

    describe("#setters", async () => {

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Sets acceptable delay", async function () {
            await expect(
                priceOracle.setAcceptableDelay(100)
            ).to.emit(
                priceOracle, "NewAcceptableDelay"
            ).withArgs(acceptableDelay, 100);

            expect(
                await priceOracle.acceptableDelay()
            ).to.equal(100);

            await expect(
                priceOracle.connect(signer1).setAcceptableDelay(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                priceOracle.setAcceptableDelay(0)
            ).to.revertedWith("PriceOracle: zero amount");

        })

        it("renounceOwnership", async function () {
            await expect(
                priceOracle.connect(signer1).renounceOwnership()
            ).to.revertedWith("Ownable: caller is not the owner");

            await priceOracle.renounceOwnership()
        })

    });

});
