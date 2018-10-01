/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const AdminConnection = require('composer-admin').AdminConnection;
const BusinessNetworkConnection = require('composer-client').BusinessNetworkConnection;
const { BusinessNetworkDefinition, CertificateUtil, IdCard } = require('composer-common');
const path = require('path');

const chai = require('chai');
chai.should();
chai.use(require('chai-as-promised'));

const namespace = 'org.tradechain.loc';
const letterId = 'L123';

describe('Letters of Credit Network', () => {
    const cardStore = require('composer-common').NetworkCardStoreManager.getCardStore( { type: 'composer-wallet-inmemory' } );
    let adminConnection;
    let businessNetworkConnection;
    let factory;

    let wapo;
    let peniel;
    let wapoRelationship;
    let penielRelationship;
    let emmaRelationship;
    let kokouRelationship;
    let rules;
    let productDetails;
    let letter;
    let letterRegistry;

    before(async () => {
        // Embedded connection used for local testing
        const connectionProfile = {
            name: 'embedded',
            'x-type': 'embedded'
        };
        // Generate certificates for use with the embedded connection
        const credentials = CertificateUtil.generate({ commonName: 'admin' });

        // PeerAdmin identity used with the admin connection to deploy business networks
        const deployerMetadata = {
            version: 1,
            userName: 'PeerAdmin',
            roles: [ 'PeerAdmin', 'ChannelAdmin' ]
        };

        const deployerCard = new IdCard(deployerMetadata, connectionProfile);
        deployerCard.setCredentials(credentials);

        const deployerCardName = 'PeerAdmin';
        adminConnection = new AdminConnection({ cardStore: cardStore });

        await adminConnection.importCard(deployerCardName, deployerCard);
        await adminConnection.connect(deployerCardName);
    });

    beforeEach(async () => {
        businessNetworkConnection = new BusinessNetworkConnection({ cardStore: cardStore });

        const adminUserName = 'admin';
        let adminCardName;
        const businessNetworkDefinition = await BusinessNetworkDefinition.fromDirectory(path.resolve(__dirname, '..'));

        // Install the Composer runtime for the new business network
        await adminConnection.install(businessNetworkDefinition);

        // Start the business network and configure a network admin identity
        const startOptions = {
            networkAdmins: [
                {
                    userName: adminUserName,
                    enrollmentSecret: 'adminpw'
                }
            ]
        };
        const adminCards = await adminConnection.start(businessNetworkDefinition.getName(), businessNetworkDefinition.getVersion(), startOptions);

        // Import the network admin identity for us to use
        adminCardName = `${adminUserName}@${businessNetworkDefinition.getName()}`;

        await adminConnection.importCard(adminCardName, adminCards.get(adminUserName));

        // Connect to the business network using the network admin identity
        await businessNetworkConnection.connect(adminCardName);

        factory = businessNetworkConnection.getBusinessNetwork().getFactory();

        // create bank participants
        const bank1 = factory.newResource(namespace, 'Bank', 'VIB');
        bank1.name = 'Vietnam International Bank';
        const bank2 = factory.newResource(namespace, 'Bank', 'SEA');
        bank2.name = 'SeaBank';

        const bankRegistry = await businessNetworkConnection.getParticipantRegistry(namespace + '.Bank');
        await bankRegistry.add(bank1);
        await bankRegistry.add(bank2);

        // create bank employees
        const employee1 = factory.newResource(namespace, 'BankEmployee', 'emma');
        employee1.name = 'Emma Gnofam';
        employee1.bank = factory.newRelationship(namespace, 'Bank', 'VIB');

        const employee2 = factory.newResource(namespace, 'BankEmployee', 'kokou');
        employee2.name = 'Kokou Abalo';
        employee2.bank = factory.newRelationship(namespace, 'Bank', 'SEA');

        const employeeRegistry = await businessNetworkConnection.getParticipantRegistry(namespace + '.BankEmployee');
        await employeeRegistry.add(employee1);
        await employeeRegistry.add(employee2);

        // create wapo participant
        wapo = factory.newResource(namespace, 'Customer', 'wapo');
        wapo.name = 'Solim';
        wapo.lastName= 'MAYABA';
        wapo.bank = factory.newRelationship(namespace, 'Bank', 'VIB');
        wapo.companyName = 'NAT\'S Company';

        // create peniel participant
        peniel = factory.newResource(namespace, 'Customer', 'peniel');
        peniel.name = 'Peniel';
        peniel.lastName= 'Winchester';
        peniel.bank = factory.newRelationship(namespace, 'Bank', 'SEA');
        peniel.companyName = 'KtxDreams Inc.';

        // add wapo and peniel participants to the registry
        const customerRegistry = await businessNetworkConnection.getParticipantRegistry(namespace + '.Customer');
        await customerRegistry.add(wapo);
        await customerRegistry.add(peniel);

        wapoRelationship = factory.newRelationship(namespace, 'Customer', wapo.getIdentifier());
        penielRelationship = factory.newRelationship(namespace, 'Customer', peniel.getIdentifier());
        emmaRelationship = factory.newRelationship(namespace, 'BankEmployee', employee1.getIdentifier());
        kokouRelationship = factory.newRelationship(namespace, 'BankEmployee', employee2.getIdentifier());

        // create some rules for the letter
        rules = [];
        const rule1 = factory.newConcept(namespace, 'Rule');
        rule1.ruleId = 'rule1';
        rule1.ruleText = 'This is a test rule';
        rules.push(rule1);
        const rule2 = factory.newConcept(namespace, 'Rule');
        rule2.ruleId = 'rule2';
        rule2.ruleText = 'This is another test rule';
        rules.push(rule2);

        // create the product details
        productDetails = factory.newConcept(namespace, 'ProductDetails');
        productDetails.productType = 'Computers';
        productDetails.quantity = 100;
        productDetails.pricePerUnit = 250;

        // create a generic letter
        letter = factory.newResource(namespace, 'LetterOfCredit', letterId);
        letter.applicant = factory.newRelationship(namespace, 'Customer', wapo.getIdentifier());
        letter.beneficiary = factory.newRelationship(namespace, 'Customer', peniel.getIdentifier());
        letter.issuingBank = wapo.bank;
        letter.exportingBank = peniel.bank;
        letter.rules = rules;
        letter.productDetails = productDetails;
        letter.evidence = [];
        letter.approval = [];
        letter.status = 'AWAITING_APPROVAL';

        letterRegistry = await businessNetworkConnection.getAssetRegistry(namespace + '.LetterOfCredit');
        await letterRegistry.add(letter);
    });

    describe('InitialApplication', () => {
        it('should be able to create a letter of credit asset', async () => {
            // create and submit the InitialApplication transaction
            const initialApplicationTx = factory.newTransaction(namespace, 'InitialApplication');
            initialApplicationTx.letterId = 'newLetter';
            initialApplicationTx.applicant = wapoRelationship;
            initialApplicationTx.beneficiary = penielRelationship;
            initialApplicationTx.rules = rules;
            initialApplicationTx.productDetails = productDetails;
            await businessNetworkConnection.submitTransaction(initialApplicationTx);

            const letterRegistry = await businessNetworkConnection.getAssetRegistry(namespace + '.LetterOfCredit');
            const letter = await letterRegistry.get('newLetter');

            letter.letterId.should.deep.equal('newLetter');
            letter.applicant.should.deep.equal(initialApplicationTx.applicant);
            letter.beneficiary.should.deep.equal(initialApplicationTx.beneficiary);
            letter.issuingBank.should.deep.equal(wapo.bank);
            letter.exportingBank.should.deep.equal(peniel.bank);
            letter.rules.should.deep.equal(rules);
            letter.productDetails.should.deep.equal(productDetails);
            letter.evidence.should.deep.equal([]);
            letter.approval.should.deep.equal([wapoRelationship]);
            letter.status.should.deep.equal('AWAITING_APPROVAL');
        });
    });

    describe('Approve', () => {
        it('should update the approval array to show that a participant has approved the letter', async () => {
            // create and submit an Approve transaction
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = wapoRelationship;
            await businessNetworkConnection.submitTransaction(approveTx);

            const approvedLetter = await letterRegistry.get(letterId);
            approvedLetter.approval.should.deep.equal([wapoRelationship]);
        });

        it('should not allow the same person to approve the letter twice', async () => {
            // update the letter to have already been approved by Alice
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship];
            await letterRegistry.update(updatedLetter);

            // attempt to submit the Approve transaction and check the error
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = wapoRelationship;
            return businessNetworkConnection.submitTransaction(approveTx).should.be.rejectedWith('This person has already approved this letter of credit');
        });

        it('should not allow an employee of a bank to approve when another employee of the same bank already has', async () => {
            const otherVIBEmployee = factory.newResource(namespace, 'BankEmployee', 'trevor');
            otherVIBEmployee.name = 'Trevor';
            otherVIBEmployee.bank = factory.newRelationship(namespace, 'Bank', 'VIB');
            const employeeRegistry = await businessNetworkConnection.getParticipantRegistry(namespace + '.BankEmployee');
            await employeeRegistry.add(otherVIBEmployee);

            // update the letter to have already been approved by Alice
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [factory.newRelationship(namespace, 'BankEmployee', otherVIBEmployee.getIdentifier())];
            await letterRegistry.update(updatedLetter);

            // attempt to submit the Approve transaction and check the error
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = emmaRelationship;
            return businessNetworkConnection.submitTransaction(approveTx).should.be.rejectedWith('Your bank has already approved of this request');
        });

        it('should mark the letter as \'approved\' when all four parties have approved the letter', async () => {
            // update the letter to have been approved by three people already
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship];
            await letterRegistry.update(updatedLetter);

            // create and submit an Approve transaction
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = penielRelationship;
            await businessNetworkConnection.submitTransaction(approveTx);

            const approvedLetter = await letterRegistry.get(letterId);
            approvedLetter.approval.should.deep.equal([wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship]);
            approvedLetter.status.should.deep.equal('APPROVED');
        });

        it('should be unable to submit an Approve transaction on a letter that has already been closed', async () => {
            // update the letter to be closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit an Approve transaction and check the error
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = wapoRelationship;
            return businessNetworkConnection.submitTransaction(approveTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit an Approve transaction on a letter that has already been rejected', async () => {
            // update the letter to be closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit an Approve transaction and check the error
            const approveTx = factory.newTransaction(namespace, 'Approve');
            approveTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            approveTx.approvingParty = wapoRelationship;
            return businessNetworkConnection.submitTransaction(approveTx).should.be.rejectedWith('This letter of credit has already been closed');
        });
    });

    describe('Reject', () => {
        it('should allow the rejection of the letter before it is fully approved', async () => {
            // create and submit a Reject transaction
            const rejectTx = factory.newTransaction(namespace, 'Reject');
            rejectTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            rejectTx.closeReason = 'testing the Reject transaction';
            await businessNetworkConnection.submitTransaction(rejectTx);

            const rejectedLetter = await letterRegistry.get(letterId);
            rejectedLetter.status.should.deep.equal('REJECTED');
            rejectedLetter.closeReason.should.deep.equal('testing the Reject transaction');
        });

        it('should be unable to submit a Reject transaction on a letter that has already been closed', async () => {
            // update the letter to have already been closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a Reject transaction and check the error
            const rejectTx = factory.newTransaction(namespace, 'Reject');
            rejectTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            rejectTx.closeReason = 'testing the Reject transaction';
            return businessNetworkConnection.submitTransaction(rejectTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit a Reject transaction on a letter that has already been rejected', async () => {
            // update the letter to have been rejected
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a Reject transaction and check the error
            const rejectTx = factory.newTransaction(namespace, 'Reject');
            rejectTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            rejectTx.closeReason = 'testing the Reject transaction';
            return businessNetworkConnection.submitTransaction(rejectTx).should.be.rejectedWith('This letter of credit has already been closed');
        });
    });

    describe('SuggestChanges', () => {
        let newRules;
        before(async () => {
            // define a new rules array to be used in the transactions
            newRules = [];
            const rule1 = factory.newConcept(namespace, 'Rule');
            rule1.ruleId = 'newRule1';
            rule1.ruleText = 'This is an updated test rule';
            newRules.push(rule1);
            const rule2 = factory.newConcept(namespace, 'Rule');
            rule2.ruleId = 'newRule2';
            rule2.ruleText = 'This is another updated test rule';
            newRules.push(rule2);
        });

        it('should update the array of rules and reset the approval array', async () => {
            // create and submit a SuggestChanges transaction
            const suggestChangesTx = factory.newTransaction(namespace, 'SuggestChanges');
            suggestChangesTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            suggestChangesTx.rules = newRules;
            suggestChangesTx.suggestingParty = emmaRelationship;
            await businessNetworkConnection.submitTransaction(suggestChangesTx);

            const changedLetter = await letterRegistry.get(letterId);
            changedLetter.rules.should.deep.equal(newRules);
            changedLetter.approval.should.deep.equal([emmaRelationship]);
        });

        it('should be unable to submit a SuggestChanges transaction on a letter that has already been shipped', async () => {
            // update the letter to have been shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'SHIPPED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a SuggestChanges transaction and check the error
            const suggestChangesTx = factory.newTransaction(namespace, 'SuggestChanges');
            suggestChangesTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            suggestChangesTx.rules = newRules;
            suggestChangesTx.suggestingParty = emmaRelationship;
            return businessNetworkConnection.submitTransaction(suggestChangesTx).should.be.rejectedWith('The product has already been shipped');
        });

        it('should be unable to submit a SuggestChanges transaction on a letter that has already been received', async () => {
            // update the letter to have been shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'RECEIVED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a SuggestChanges transaction and check the error
            const suggestChangesTx = factory.newTransaction(namespace, 'SuggestChanges');
            suggestChangesTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            suggestChangesTx.rules = newRules;
            suggestChangesTx.suggestingParty = emmaRelationship;
            return businessNetworkConnection.submitTransaction(suggestChangesTx).should.be.rejectedWith('The product has already been shipped');
        });


        it('should be unable to submit a SuggestChanges transaction on a letter that has already been closed', async () => {
            // update the letter to have already been closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a SuggestChanges transaction and check the error
            const suggestChangesTx = factory.newTransaction(namespace, 'SuggestChanges');
            suggestChangesTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            suggestChangesTx.rules = newRules;
            suggestChangesTx.suggestingParty = emmaRelationship;
            return businessNetworkConnection.submitTransaction(suggestChangesTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit a SuggestChanges transaction on a letter that has already been rejected', async () => {
            // update the letter to have been rejected
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a SuggestChanges transaction and check the error
            const suggestChangesTx = factory.newTransaction(namespace, 'SuggestChanges');
            suggestChangesTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            suggestChangesTx.rules = newRules;
            suggestChangesTx.suggestingParty = emmaRelationship;
            return businessNetworkConnection.submitTransaction(suggestChangesTx).should.be.rejectedWith('This letter of credit has already been closed');
        });
    });

    describe('ShipProduct', () => {
        it('should not update the status if the letter has not been fully approved', async () => {
            // attempt to submit the ShipProduct transaction against the unapproved letter, and check the error
            const shipProductTx = factory.newTransaction(namespace, 'ShipProduct');
            shipProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            shipProductTx.evidence = 'asdfghjk';
            return businessNetworkConnection.submitTransaction(shipProductTx).should.be.rejectedWith('This letter needs to be fully approved before the product can be shipped');
        });

        it('should mark the letter as \'shipped\' if it has been fully approved', async () => {
            // update the created letter so that it is ready to be shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'APPROVED';
            await letterRegistry.update(updatedLetter);

            // create and submit a ShipProduct transaction
            const shipProductTx = factory.newTransaction(namespace, 'ShipProduct');
            shipProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            shipProductTx.evidence = 'asdfghjk';
            await businessNetworkConnection.submitTransaction(shipProductTx);

            const shippedLetter = await letterRegistry.get(letterId);
            shippedLetter.status.should.deep.equal('SHIPPED');
            shippedLetter.evidence.should.deep.equal(['asdfghjk']);
        });

        it('should do nothing if the letter has already been marked as \'shipped\'', async () => {
            // update the letter so that is has already been marked as shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'SHIPPED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit the ShipProduct transaction and check the error
            const shipProductTx = factory.newTransaction(namespace, 'ShipProduct');
            shipProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            shipProductTx.evidence = 'asdfghjk';
            return businessNetworkConnection.submitTransaction(shipProductTx).should.be.rejectedWith('The product has already been shipped');
        });

        it('should be unable to submit a ShipProduct transaction on a letter that has already been closed', async () => {
            // update the letter to have already been closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a ShipProduct transaction and check the error
            const shipProductTx = factory.newTransaction(namespace, 'ShipProduct');
            shipProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            shipProductTx.evidence = 'asdfghjk';
            return businessNetworkConnection.submitTransaction(shipProductTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit a ShipProduct transaction on a letter that has already been rejected', async () => {
            // update the letter to have been rejected
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a ShipProduct transaction and check the error
            const shipProductTx = factory.newTransaction(namespace, 'ShipProduct');
            shipProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            shipProductTx.evidence = 'asdfghjk';
            return businessNetworkConnection.submitTransaction(shipProductTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

    });

    describe('ReceiveProduct', () => {
        it('should not update the status if the letter has not yet been fully approved', async () => {
            // attempt to submit a ReceiveProduct transaction against the unshipped letter, and check the error
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx. loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(receiveProductTx).should.be.rejectedWith('The product needs to be shipped before it can be received');
        });

        it('should not update the status if the letter has not been marked as \'shipped\'', async () => {
            // update the letter to be approved but not shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'APPROVED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a ReceiveProduct transaction against the unshipped letter, and check the error
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx. loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(receiveProductTx).should.be.rejectedWith('The product needs to be shipped before it can be received');
        });

        it('should mark the letter as \'received\' if it has been shipped', async () => {
            // update the letter to be shipped
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'SHIPPED';
            await letterRegistry.update(updatedLetter);

            // create and submit the ReceiveProduct transaction
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            await businessNetworkConnection.submitTransaction(receiveProductTx);

            const receivedLetter = await letterRegistry.get(letterId);
            receivedLetter.status.should.deep.equal('RECEIVED');
        });

        it('should do nothing if the letter has already been marked as \'received\'', async () => {
            // update the letter so that is has already been marked as received
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'RECEIVED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit the ReceiveProduct transaction and check the error
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(receiveProductTx).should.be.rejectedWith('The product has already been received');
        });

        it('should be unable to submit a ReceiveProduct transaction on a letter that has already been closed', async () => {
            // update the letter to have already been closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a ReceiveProduct transaction and check the error
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(receiveProductTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit a ReceiveProduct transaction on a letter that has already been rejected', async () => {
            // update the letter to have been rejected
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a ReceiveProduct transaction and check the error
            const receiveProductTx = factory.newTransaction(namespace, 'ReceiveProduct');
            receiveProductTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(receiveProductTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

    });

    describe('ReadyForPayment', () => {
        it('should not ready payment the letter if it is not marked as \'received\'', async () => {
            const readyTx = factory.newTransaction(namespace, 'ReadyForPayment');
            readyTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(readyTx).should.be.rejectedWith('The payment cannot be made until the product has been received by the applicant');
        });

        it('should mark the letter as ready for payment', async () => {
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'RECEIVED';
            await letterRegistry.update(updatedLetter);

            const readyTx = factory.newTransaction(namespace, 'ReadyForPayment');
            readyTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            await businessNetworkConnection.submitTransaction(readyTx);

            const readyLetter = await letterRegistry.get(letterId);
            readyLetter.status.should.deep.equal('READY_FOR_PAYMENT');
        });

        it('should not ready payment the letter if it is marked as \'closed\'', async () => {
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            const readyTx = factory.newTransaction(namespace, 'ReadyForPayment');
            readyTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(readyTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should not ready payment the letter if it is marked as \'rejected\'', async () => {
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            const readyTx = factory.newTransaction(namespace, 'ReadyForPayment');
            readyTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(readyTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should not ready payment the letter if it is marked as \'ready for payment\'', async () => {
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'READY_FOR_PAYMENT';
            await letterRegistry.update(updatedLetter);

            const readyTx = factory.newTransaction(namespace, 'ReadyForPayment');
            readyTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            return businessNetworkConnection.submitTransaction(readyTx).should.be.rejectedWith('The payment has already been made');
        });
    });

    describe('Close', () => {
        it('should not close the letter if it is not marked as \'ready for payment\'', async () => {
            // attempt to submit a Close transaction and check the error
            const closeTx = factory.newTransaction(namespace, 'Close');
            closeTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            closeTx.closeReason = 'testing the Close transaction';
            return businessNetworkConnection.submitTransaction(closeTx).should.be.rejectedWith('Cannot close this letter of credit until it is fully approved and the product has been received by the applicant');
        });

        it('should mark the letter as closed', async () => {
            // update the letter so it is ready to close
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'READY_FOR_PAYMENT';
            await letterRegistry.update(updatedLetter);

            // create and submit a Close transaction
            const closeTx = factory.newTransaction(namespace, 'Close');
            closeTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            closeTx.closeReason = 'testing the Close transaction';
            await businessNetworkConnection.submitTransaction(closeTx);

            const closedLetter = await letterRegistry.get(letterId);
            closedLetter.status.should.deep.equal('CLOSED');
            closedLetter.closeReason.should.deep.equal('testing the Close transaction');
        });

        it('should be unable to submit a Close transaction on a letter that has already been closed', async () => {
            // update the letter to have already been closed
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.approval = [wapoRelationship, emmaRelationship, kokouRelationship, penielRelationship];
            updatedLetter.status = 'CLOSED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a Close transaction and check the error
            const closeTx = factory.newTransaction(namespace, 'Close');
            closeTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            closeTx.closeReason = 'testing the Close transaction';
            return businessNetworkConnection.submitTransaction(closeTx).should.be.rejectedWith('This letter of credit has already been closed');
        });

        it('should be unable to submit a Close transaction on a letter that has already been rejected', async () => {
            // update the letter to have been rejected
            let updatedLetter = await letterRegistry.get(letterId);
            updatedLetter.status = 'REJECTED';
            await letterRegistry.update(updatedLetter);

            // attempt to submit a Close transaction and check the error
            const closeTx = factory.newTransaction(namespace, 'Close');
            closeTx.loc = factory.newRelationship(namespace, 'LetterOfCredit', letterId);
            closeTx.closeReason = 'testing the Close transaction';
            return businessNetworkConnection.submitTransaction(closeTx).should.be.rejectedWith('This letter of credit has already been closed');
        });
    });

});
