const Account = require('./configs/account');
const HolyShit = require('./helpers/top_coders');
const Utils = require('./helpers/my_utils');
const User = require('./crawl_user');
const Request = require('request');
const Promise = require('bluebird');
const Firebase = require('firebase');

var ref = new Firebase(Account.firebase_url);
var user_events_ref = ref.child("user_events");
var user_ranking_info_ref = ref.child("user_ranking_info");

var crawl_github_auth = function (production) {

    ref.authWithCustomToken(Account.firebase_secrets, function (error, authData) {
        if (error) {
            console.log("Login Failed!", error);
            terminate_app();
        } else {
            console.log("Login Succeeded!", authData);
            crawl_github(production);
        }
    });
}

var crawl_github = function (production) {

    var github_info = {
        'members_list': [],
        'repository_list': []
    }

    var current_time = Utils.get_current_timestamp();

    var funcs = Promise.resolve(Utils.make_range(1, 10).map((n) => makeRequest(make_option(n), 'members_list')));

    funcs
        .mapSeries(iterator)
        .catch(function (err) {
            console.log(err);
        })
        .finally(function () {

            var user_events = [];

            // Crawl BitTiger members
            var members_list = github_info['members_list'];
            for (var i = 0; i < members_list.length; ++i) {
                members_list[i]['organization'] = 'bittiger';
                user_events.push(User.crawl_user(members_list[i]));
            }

            // Crawl top coders
            for (var i = 0; i < HolyShit.top_coders.length; i++) {
                user_events.push(User.crawl_user(HolyShit.top_coders[i]));
            }

            // Wait all the crawling to finish
            Promise.all(user_events)
                .catch(function (err) {
                    console.log(err);
                })
                .then(function (member_events) {

                    // sort the members based on events
                    member_events.sort(function (a, b) {

                        if (b['Total'] != a['Total']) {
                            return b['Total'] - a['Total'];
                        } else if (b['PushEvent'] != a['PushEvent']) {
                            return b['PushEvent'] - a['PushEvent'];
                        } else if (b['PullRequestEvent'] != a['PullRequestEvent']) {
                            return b['PullRequestEvent'] - a['PullRequestEvent'];
                        } else if (b['CreateEvent'] != a['CreateEvent']) {
                            return b['CreateEvent'] - a['CreateEvent'];
                        } else {
                            return b['ForkEvent'] - a['ForkEvent'];
                        }
                    });

                    // retrieve members' last ranking from Firebase
                    var previous_rankings_promise = retrieve_previous_user_ranking();
                    previous_rankings_promise
                        .catch(function (err) {
                            console.log(err);
                        })
                        .then(function (previous_rankings) {

                            for (var i = 0; i < member_events.length; i++) {
                                var user = member_events[i].login;
                                var current_ranking = i + 1;
                                if (previous_rankings[user]) {
                                    var ranking_records = previous_rankings[user];
                                    var last_ranking = ranking_records[ranking_records.length - 1].ranking;

                                    member_events[i].ranking_change = current_ranking - last_ranking;
                                    previous_rankings[user].push({
                                        'timestamp': current_time,
                                        'ranking': current_ranking
                                    });


                                    // Adjust the previous ranking range. If we have more than 100 records, we'll keep the latest 30 records.
                                    if (previous_rankings[user].length > 100) {
                                        var pre_range = previous_rankings[user];
                                        var pre_range_len = pre_range.length;
                                        var lastest_30_range = previous_range.slice(pre_range_len - 30, pre_range_len);
                                        previous_rankings[user] = lastest_30_range;
                                    }
                                } else {
                                    // user not exists in last rankings
                                    previous_rankings[user] = [{
                                        'timestamp': current_time,
                                        'ranking': current_ranking
                                    }];
                                    member_events[i].ranking_change = 'new';
                                }

                                var len = previous_rankings[user].length;
                                var max_num = 30;
                                if (len <= max_num) {
                                    member_events[i].ranking_history = previous_rankings[user];
                                } else {
                                    var last_few_records = previous_rankings[user].slice(len - max_num, len);
                                    member_events[i].ranking_history = last_few_records;
                                }
                            }

                            // update members' ranking records to Firebase
                            if (production) {
                                update_previous_user_ranking(previous_rankings);
                            }

                            // retrieve the top 25 users' information
                            top25_members = member_events.slice(0, 25);
                            console.log('Updating the database...');
                            promise_events_update = user_events_ref.child('events').set(top25_members);
                            promise_time_udpate =
                                user_events_ref.child('created_time').set(current_time);

                            Promise.all([promise_events_update, promise_time_udpate])
                                .catch(function (err) {
                                    console.log(err);
                                })
                                .finally(terminate_app);
                        });
                });
        })

    function iterator(f) {
        return f()
    }

    function makeRequest(option, key) {
        return function () {
            return new Promise(function (fulfill, reject) {
                Request(option, function (error, response, body) {
                    if (error) {
                        reject(error);
                    } else if (body.length == 0) {
                        reject('page empty');
                    } else {
                        github_info[key] = github_info[key].concat(body);
                        fulfill(body);
                    }
                })
            });
        };
    }

    function make_option(page_number) {
        return {
            url: 'https://api.github.com/orgs/bittigerInst/members', // URL to hit
            qs: { // Query string data
                page: page_number
            },
            method: 'GET', // Specify the method
            headers: { // Define headers
                'User-Agent': 'request'
            },
            auth: { // HTTP Authentication
                user: Account.username,
                pass: Account.password
            },
            json: true
        };
    }
}

function terminate_app() {
    console.log("Finished!");
    //process.exit();
}

function retrieve_previous_user_ranking() {
    return new Promise(function (fulfill, reject) {
        user_ranking_info_ref.once("value", function (user_ranking_info) {
            var result;
            if (user_ranking_info.val() == null) {
                // Initialize the data
                console.log("user_ranking_info == null");
                result = {};
            } else {
                result = user_ranking_info.val();
            }
            fulfill(result);
        });
    });
}

function update_previous_user_ranking(new_records) {
    user_ranking_info_ref.set(new_records);
}

exports.crawl_github = crawl_github_auth;