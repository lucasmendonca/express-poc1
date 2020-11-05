const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const { Op } = require('sequelize');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile, async (req, res) => {
    const {Contract} = req.app.get('models');
    const {id} = req.params;

    const contract = await Contract.findOne({
        where: {id, ClientId: req.profile.id }
    });

    if(!contract) return res.status(404).end();

    res.json(contract);
});

/**
 * @returns a list of contracts belonging to a user (client or contractor) - only non terminated contracts
 */
app.get('/contracts', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models');

    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                {ClientId: req.profile.id},
                {ContractorId: req.profile.id},
            ],
            status: {
                [Op.ne]: 'terminated'
            }
        }
    });

    if(!contracts) return res.status(404).end();

    res.json(contracts);
});

/**
 * @returns all unpaid jobs for a user (either a client or contractor), for active contracts only.
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Job, Contract} = req.app.get('models');

    const jobs = await Job.findAll({
        where: {
            paid: {
                [Op.not]: true
            }
        },
        include: {
            model: Contract, 
            where: {
                [Op.or]: [
                    {ClientId: req.profile.id},
                    {ContractorId: req.profile.id},
                ]
            }
        }
    });

    if(!jobs) return res.status(404).end();

    res.json(jobs);
});

/**
 * @returns all jobs for a user
 */
app.get('/jobs', getProfile, async (req, res) => {
    const {Job, Contract, Profile} = req.app.get('models');

    const jobs = await Job.findAll({
        include: {
            model: Contract, 
            where: {
                [Op.or]: [
                    {ClientId: req.profile.id},
                    {ContractorId: req.profile.id},
                ]
            }
        }
    });

    if(!jobs) return res.status(404).end();

    res.json(jobs);
});


/**
 *  pay for a job, a client can only pay if his balance >= the amount to pay
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const {Job, Contract, Profile} = req.app.get('models');
    const {job_id} = req.params;

    const job = await Job.findOne({
        where: {
            id: job_id,
            paid: {
                [Op.not]: true
            }
        },
        include: {
            model: Contract,
            attributes: ['ContractorId', 'ClientId'],
            where: {
                ClientId: req.profile.id
            }
        }
    });

    if(!job) return res.status(404).end();

    if (job.price > req.profile.balance) {
        return res.status(424).json({ error: 'insufficient_balance' });
    } else {
        const t = await sequelize.transaction();

        try {
            const contractor = await Profile.findOne({
                where: {
                    id: job.Contract.ContractorId
                }
            });

            job.paid = true;
            job.paymentDate = new Date().toISOString();
            job.save();

            // TODO: fix js math errors
            req.profile.balance -= job.price;
            req.profile.save();

            contractor.balance += job.price;
            contractor.save();

            await t.commit();
        } catch(err) {
            await t.rollback();
            return res.status(500).json({ error: 'Something goes wrong... :(', data: err });
        }
    }

    res.json(job);
});

/**
 * Deposits money into the balance of a client, a client can't deposit more than 25% his total of jobs to pay. (at the deposit moment)
 */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
   // TODO: scope needs to be clarified : userId VS profile_id, which one should receive the deposit?
   // res.json(res);
});

/**
 * @eturns the profession that earned most money (sum of paid jobs) for any contactor that worked in the query time range.
 */
app.get('/admin/best-profession', async (req, res) => {
    const { Contract, Job } = req.app.get('models');
    const { start, end } = req.query;

    const contractor = await Contract.findAll({
        attributes: ['ContractorId'], 
        group: ["Contract.ContractorId"],
    
        include: {
            model: Job,
            attributes: [
                [sequelize.fn('sum', sequelize.col('price')), 'total_amount']
            ], 
            where: {
                paid: true,

            }
        }
        // where: {
        //     [Op.or]: [
        //         {ClientId: req.profile.id},
        //         {ContractorId: req.profile.id},
        //     ],
        //     status: {
        //         [Op.ne]: 'terminated'
        //     }
        // }
    })
    .then((res) => {
        return res.map((data) => {
            console.log('data', data.Jobs)
            return {
                ContractorId: data.ContractorId,
                total_amount: data.Jobs[0].dataValues.total_amount
            }
        }).sort((a, b) => {
            if (a.total_amount > b.total_amount) {
                return -1;
              }
              if (a.total_amount < b.total_amount) {
                return 1;
              }

              return 0;
        })[0];
    })

    if(!contractor) return res.status(404).end();

    res.json(contractor);
});

/**
 * @returns data of the client / contractor
 */
app.get('/me',getProfile, async (req, res) => {
    res.json(req.profile);
});


module.exports = app;
